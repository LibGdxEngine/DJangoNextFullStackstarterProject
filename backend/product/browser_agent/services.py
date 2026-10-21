"""Executes one AgentRun: browser session, LangGraph agent, event/artifact recording."""
import asyncio
import logging
import shutil
import uuid
from pathlib import Path

from asgiref.sync import sync_to_async
from django.conf import settings
from django.utils import timezone

from .live import LiveScreencast
from .models import AgentArtifact, AgentRun, AgentRunEvent, BrowserProfile

logger = logging.getLogger(__name__)

PAYLOAD_LIMIT = 2000


def run_directory(run: AgentRun) -> Path:
    return settings.AGENT_RUNS_ROOT / str(run.id)


def _clip(value) -> str:
    text = value if isinstance(value, str) else str(value)
    return text[:PAYLOAD_LIMIT]


def _message_events(message) -> list[tuple[str, dict]]:
    """Translate one LangChain message into zero or more (kind, payload) events."""
    from langchain_core.messages import AIMessage, ToolMessage
    from .engine.agent import _text

    if isinstance(message, ToolMessage):
        return [(AgentRunEvent.Kind.TOOL_RESULT, {'name': message.name, 'content': _clip(message.content)})]
    if isinstance(message, AIMessage):
        events = []
        text = _text(message).strip()
        if text:
            events.append((AgentRunEvent.Kind.MESSAGE, {'text': _clip(text)}))
        for call in message.tool_calls or []:
            events.append((AgentRunEvent.Kind.TOOL_CALL, {'name': call['name'], 'args': call.get('args') or {}}))
        return events
    return []


def _finish(run: AgentRun, status: str, *, final_text: str = '', error: str = '', usage: dict | None = None,
            release_profile: bool = True):
    run.status = status
    run.final_text = final_text or run.final_text
    run.error = error or run.error
    run.usage = usage or run.usage
    run.finished_at = timezone.now()
    run.save()
    if release_profile and run.profile_id:
        BrowserProfile.objects.filter(pk=run.profile_id).update(in_use=False)


@sync_to_async
def _claim(run_id) -> AgentRun | None:
    """Move a queued run to running; None if it was cancelled or already picked up."""
    run = AgentRun.objects.select_related('profile').get(pk=run_id)
    if run.status != AgentRun.Status.QUEUED:
        return None
    if run.cancel_requested:
        _finish(run, AgentRun.Status.CANCELLED, release_profile=False)
        return None
    if run.profile_id:
        claimed = BrowserProfile.objects.filter(pk=run.profile_id, in_use=False).update(in_use=True)
        if not claimed:
            run.error = 'Browser profile is in use by another run.'
            _finish(run, AgentRun.Status.FAILED, release_profile=False)
            return None
    run.status = AgentRun.Status.RUNNING
    run.started_at = timezone.now()
    run.save(update_fields=['status', 'started_at', 'updated_at'])
    return run


@sync_to_async
def _record_events(run_id, start_seq: int, events: list[tuple[str, dict]]) -> int:
    AgentRunEvent.objects.bulk_create([
        AgentRunEvent(run_id=run_id, seq=start_seq + i, kind=kind, payload=payload)
        for i, (kind, payload) in enumerate(events)
    ])
    return start_seq + len(events)


@sync_to_async
def _cancel_requested(run_id) -> bool:
    return AgentRun.objects.filter(pk=run_id, cancel_requested=True).exists()


@sync_to_async
def _collect_artifacts(run: AgentRun) -> None:
    root = run_directory(run)
    for sub, kind in (('screenshots', AgentArtifact.Kind.SCREENSHOT), ('workspace', AgentArtifact.Kind.FILE)):
        folder = root / sub
        if not folder.exists():
            continue
        for path in sorted(folder.rglob('*')):
            if path.is_file():
                AgentArtifact.objects.get_or_create(
                    run=run, path=path.relative_to(root).as_posix(),
                    defaults={'kind': kind, 'size': path.stat().st_size})


@sync_to_async
def _complete(run: AgentRun, status: str, **kwargs) -> None:
    run.refresh_from_db()
    _finish(run, status, **kwargs)


class RunCancelled(Exception):
    pass


async def execute_run(run_id) -> None:
    """Run the agent for ``run_id`` to completion. Agent failures are recorded, not raised."""
    run = await _claim(run_id)
    if run is None:
        return

    from langgraph.errors import GraphRecursionError

    from .engine.agent import Usage, _text, build_agent
    from .engine.browser_tools import BrowserSession, make_browser_tools

    recursion_limit = settings.AGENT_RECURSION_LIMIT
    root = run_directory(run)
    workspace = root / 'workspace'
    workspace.mkdir(parents=True, exist_ok=True)

    session = BrowserSession.from_env()
    if run.profile_id:
        session.profile_dir = str(run.profile.directory)
    else:
        # Throwaway profile so concurrent runs never fight over one Chromium profile.
        session.profile_dir = None

    usage = Usage()
    status, error, final_text = AgentRun.Status.SUCCEEDED, '', ''
    seq = seen = 0
    live = LiveScreencast(session, run.id)
    try:
        await session.start()
        live.start()
        await session.verify_ip()
        tools = make_browser_tools(
            session, screenshot_dir=str(root / 'screenshots'), files_dir=str(workspace))
        agent = build_agent(session, tools=tools, workspace=str(workspace))

        async def consume():
            nonlocal seq, seen, final_text
            async for chunk in agent.astream(
                    {'messages': [{'role': 'user', 'content': run.task}]},
                    config={'configurable': {'thread_id': str(uuid.uuid4())},
                            'recursion_limit': recursion_limit},
                    stream_mode='values'):
                messages = chunk['messages']
                events = []
                for message in messages[seen:]:
                    usage.add(message)
                    events.extend(_message_events(message))
                seen = len(messages)
                if events:
                    seq = await _record_events(run.id, seq, events)
                final_text = _text(messages[-1])
                if await _cancel_requested(run.id):
                    raise RunCancelled

        await asyncio.wait_for(consume(), settings.AGENT_RUN_TIMEOUT)
    except RunCancelled:
        status = AgentRun.Status.CANCELLED
    except asyncio.TimeoutError:
        status, error = AgentRun.Status.TIMEOUT, f'No answer after {settings.AGENT_RUN_TIMEOUT}s'
    except GraphRecursionError:
        status, error = AgentRun.Status.FAILED, f'Hit the {recursion_limit}-step limit'
    except Exception as exc:  # the run records the failure; the worker stays healthy
        logger.exception('Agent run %s failed', run.id)
        status, error = AgentRun.Status.FAILED, f'{type(exc).__name__}: {exc}'[:500]
    finally:
        await live.stop()
        try:
            await session.stop()
        except Exception:
            logger.exception('Stopping browser for run %s failed', run.id)

    await _collect_artifacts(run)
    await _complete(run, status, final_text=final_text, error=error, usage={
        'calls': usage.calls, 'input_tokens': usage.input, 'output_tokens': usage.output,
        'tool_calls': usage.tool_calls, 'cost': round(usage.cost, 6),
        'llm_s': round(usage.llm_s, 2), 'tool_s': round(usage.tool_s, 2),
    })


def purge_run_files(run: AgentRun) -> None:
    shutil.rmtree(run_directory(run), ignore_errors=True)
