"""Executes one AgentRun: browser session, LangGraph agent, event/artifact recording.

A run's graph is checkpointed under the run's id, so one execution can stop and a
later one carry on from the last finished step: after the agent asks the user
something (the run waits, and the answer queues it again) or after its worker died
(the reaper queues it again)."""
import asyncio
import inspect
import logging
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from asgiref.sync import sync_to_async
from django.conf import settings
from django.utils import timezone

from .live import LiveScreencast
from .models import AgentArtifact, AgentRun, AgentRunEvent, BrowserProfile

logger = logging.getLogger(__name__)

PAYLOAD_LIMIT = 2000
# How a tool result starts when the step did not do what was asked. The run view uses
# the status to mark the step; the model still gets the full text.
FAILURE_PREFIXES = ('Error', 'Failed', 'Fetch failed', 'Download failed', 'Could not', 'Skipped',
                    'Blocked', 'Not done', 'Nobody took over', 'No element', 'No repeated items',
                    'Give a list', 'mode must be', '(This looks like a sign-in wall', '(This page is a bot check',
                    'The user gave up')
# Files Chromium leaves in a profile folder to mark it open. A run holds its profile
# exclusively (BrowserProfile.in_use), so any of these present before launch were left
# by a worker that died, and Chromium would refuse to open the profile over them.
CHROMIUM_LOCK_FILES = ('SingletonLock', 'SingletonSocket', 'SingletonCookie')


class ProfileBusy(Exception):
    """The run's browser profile is open in another run; the run stays queued to be retried."""


def run_directory(run: AgentRun) -> Path:
    return settings.AGENT_RUNS_ROOT / str(run.id)


def _clip(value) -> str:
    text = value if isinstance(value, str) else str(value)
    return text[:PAYLOAD_LIMIT]


def result_status(message) -> str:
    """'error' when the tool itself failed (an unknown tool, an exception), 'failed'
    when it ran but reports that the step did not work, else 'ok'."""
    if getattr(message, 'status', 'success') == 'error':
        return 'error'
    content = message.content if isinstance(message.content, str) else ''
    first = content.lstrip().split('\n', 1)[0]
    # A repeat note or a retry note comes before the result it wraps.
    for prefix in ('Note: you already ran', '(Retried after'):
        if first.startswith(prefix) and '\n' in content:
            first = content.split('\n', 1)[1].lstrip().split('\n', 1)[0]
    return 'failed' if first.startswith(FAILURE_PREFIXES) else 'ok'


def _message_events(message) -> list[tuple[str, dict]]:
    """Translate one LangChain message into zero or more (kind, payload) events. A tool
    call carries its id and a tool result the id of its call, so the run view can pair
    them even when calls ran in parallel; the result also says whether the step worked
    and how long the tool took (StepTimer)."""
    from langchain_core.messages import AIMessage, ToolMessage
    from .engine.agent import _text

    if isinstance(message, ToolMessage):
        payload = {'name': message.name, 'content': _clip(message.content), 'call_id': message.tool_call_id,
                   'status': result_status(message)}
        seconds = message.additional_kwargs.get('tool_s')
        if seconds is not None:
            payload['seconds'] = round(float(seconds), 1)
        return [(AgentRunEvent.Kind.TOOL_RESULT, payload)]
    if isinstance(message, AIMessage):
        events = []
        text = _text(message).strip()
        if text:
            events.append((AgentRunEvent.Kind.MESSAGE, {'text': _clip(text)}))
        for call in message.tool_calls or []:
            events.append((AgentRunEvent.Kind.TOOL_CALL,
                           {'name': call['name'], 'args': call.get('args') or {}, 'id': call.get('id')}))
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
    run = AgentRun.objects.select_related('profile', 'role').get(pk=run_id)
    if run.status != AgentRun.Status.QUEUED:
        return None
    if run.cancel_requested:
        _finish(run, AgentRun.Status.CANCELLED, release_profile=False)
        return None
    if run.profile_id:
        claimed = BrowserProfile.objects.filter(pk=run.profile_id, in_use=False).update(in_use=True)
        if not claimed:
            # One Chromium at a time per profile. The run waits its turn (the task retries
            # it) unless it has already waited as long as a whole run may take.
            waited = (timezone.now() - run.updated_at).total_seconds()
            if waited > settings.AGENT_RUN_TIMEOUT:
                run.error = f'Browser profile was in use by another run for over {int(waited)}s.'
                _finish(run, AgentRun.Status.FAILED, release_profile=False)
                return None
            raise ProfileBusy(str(run.profile_id))
    run.status = AgentRun.Status.RUNNING
    run.started_at = run.started_at or timezone.now()
    run.heartbeat_at = timezone.now()
    run.model = run.model or configured_model()
    run.save(update_fields=['status', 'started_at', 'heartbeat_at', 'model', 'updated_at'])
    return run


def configured_model() -> str:
    """The model name the worker will run with, as the engine reads it from the
    environment (MODEL, filled from AGENT_MODEL in compose); recorded on each run."""
    from .engine.agent import MODEL

    return MODEL[:200]


@sync_to_async
def _next_seq(run_id) -> int:
    last = AgentRunEvent.objects.filter(run_id=run_id).order_by('-seq').values_list('seq', flat=True).first()
    return 0 if last is None else last + 1


@sync_to_async
def _beat(run_id, url: str) -> None:
    fields = {'heartbeat_at': timezone.now()}
    if url.startswith('http'):
        fields['last_url'] = url[:2000]
    AgentRun.objects.filter(pk=run_id, status=AgentRun.Status.RUNNING).update(**fields)


def _page_url(session) -> str:
    page = getattr(session, 'page', None)
    try:
        return '' if page is None or page.is_closed() else str(page.url)
    except Exception:
        return ''


async def _save_logins(session) -> None:
    """Write the browser's session cookies into its profile now, not only when the browser
    closes, so a sign-in made during the run survives this worker dying."""
    save = getattr(session, '_save_session_cookies', None)
    if save is None:
        return
    result = save()
    if inspect.isawaitable(result):
        await result


async def _keep_beating(run_id, session) -> None:
    """Tell the reaper this run's worker is alive, remember the page to reopen, and keep
    the profile's saved sign-ins current."""
    while True:
        await asyncio.sleep(settings.AGENT_HEARTBEAT_S)
        try:
            await _beat(run_id, _page_url(session))
            await _save_logins(session)
        except Exception:
            logger.exception('Heartbeat for run %s failed', run_id)


@sync_to_async
def _take_answer(run_id) -> str:
    """The answer the run resumes with; clears the question so the run no longer shows it."""
    run = AgentRun.objects.get(pk=run_id)
    answer = run.answer
    AgentRun.objects.filter(pk=run_id).update(question=None, answer='', updated_at=timezone.now())
    return answer


@sync_to_async
def _pause(run_id, question: dict, url: str, usage: dict) -> None:
    """Park the run until the user answers; its worker and browser profile are freed meanwhile."""
    run = AgentRun.objects.get(pk=run_id)
    run.status = AgentRun.Status.WAITING
    run.question = question
    run.answer = ''
    run.last_url = url[:2000] if url.startswith('http') else run.last_url
    run.usage = usage
    run.heartbeat_at = None
    run.save()
    if run.profile_id:
        BrowserProfile.objects.filter(pk=run.profile_id).update(in_use=False)


def cancel_waiting_run(run: AgentRun) -> None:
    """End a run that is waiting for the user; no worker holds it to notice a cancel request."""
    now = timezone.now()
    AgentRun.objects.filter(pk=run.pk, status=AgentRun.Status.WAITING).update(
        status=AgentRun.Status.CANCELLED, question=None, answer='', finished_at=now, updated_at=now)


@asynccontextmanager
async def open_checkpointer():
    """Checkpoints in the app's Postgres, so a run survives its worker and its pauses.
    On another database (SQLite in a bare dev setup) they are in memory, so a resumed
    run starts its task over."""
    from django.db import connection

    if connection.vendor != 'postgresql':
        from langgraph.checkpoint.memory import InMemorySaver
        yield InMemorySaver()
        return
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg.conninfo import make_conninfo

    db = connection.settings_dict
    conninfo = make_conninfo(dbname=db['NAME'], user=db['USER'], password=db['PASSWORD'],
                             host=db['HOST'], port=db['PORT'])
    async with AsyncPostgresSaver.from_conn_string(conninfo) as saver:
        await saver.setup()
        yield saver


async def _reopen(session, url: str) -> None:
    """Put a resumed run back on the page it was on."""
    from .engine.browser_tools import NAV_TIMEOUT_MS

    if not url or not session.url_allowed(url):
        return
    try:
        await session.page.goto(url, timeout=NAV_TIMEOUT_MS)
    except Exception as exc:  # the agent will notice and browse again
        logger.warning('Could not reopen %s: %s', url, exc)


def _usage_totals(previous: dict, usage) -> dict:
    """This execution's usage added to what earlier executions of the run recorded."""
    previous = previous or {}
    return {
        'calls': previous.get('calls', 0) + usage.calls,
        'input_tokens': previous.get('input_tokens', 0) + usage.input,
        'output_tokens': previous.get('output_tokens', 0) + usage.output,
        'tool_calls': previous.get('tool_calls', 0) + usage.tool_calls,
        'cost': round(previous.get('cost', 0) + usage.cost, 6),
        'llm_s': round(previous.get('llm_s', 0) + usage.llm_s, 2),
        'tool_s': round(previous.get('tool_s', 0) + usage.tool_s, 2),
    }


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


def clear_stale_locks(directory: Path) -> None:
    """Remove Chromium's lock files from a profile folder before launching in it."""
    for name in CHROMIUM_LOCK_FILES:
        path = directory / name
        try:
            if path.is_symlink() or path.exists():
                path.unlink()
        except OSError:
            logger.warning('Could not remove stale lock %s', path)


def collect_artifacts(run: AgentRun) -> None:
    """Record the run's screenshots and workspace files. Safe to call repeatedly while the
    run is still writing: sizes are refreshed for files that keep growing."""
    root = run_directory(run)
    known = {a.path: a for a in run.artifacts.all()}
    for sub, kind in (('screenshots', AgentArtifact.Kind.SCREENSHOT), ('workspace', AgentArtifact.Kind.FILE)):
        folder = root / sub
        if not folder.exists():
            continue
        for path in sorted(folder.rglob('*')):
            if not path.is_file():
                continue
            relative, size = path.relative_to(root).as_posix(), path.stat().st_size
            artifact = known.get(relative)
            if artifact is None:
                AgentArtifact.objects.get_or_create(run=run, path=relative, defaults={'kind': kind, 'size': size})
            elif artifact.size != size:
                AgentArtifact.objects.filter(pk=artifact.pk).update(size=size)


_collect_artifacts = sync_to_async(collect_artifacts)


@sync_to_async
def _complete(run: AgentRun, status: str, **kwargs) -> None:
    run.refresh_from_db()
    _finish(run, status, **kwargs)


class RunCancelled(Exception):
    pass


HANDOFF_TIMEOUT_S = 10 * 60

BROWSING_PROMPT = """

Reading pages and finishing actions:
- Read the page first (`read_current_page`, `find_on_page`); take a `screenshot` only
  when the text does not explain what is blocking you, such as a control that does not
  react or a layout question the text cannot answer.
- When a click is intercepted by a dialog or overlay, do not repeat it. Close the
  overlay once (`press_key` Escape or `dismiss_overlays`); if the click still fails,
  `browse` to the direct URL of the action instead (the composer, the settings page,
  the form) rather than clicking its button on the page that hides it.
- After posting, submitting, sending or saving anything, open the destination (the
  profile, the sent folder, the list the item should appear in) and confirm the result
  is there with the settings you chose before you report success. Returning to the
  home page is not confirmation.
- Bot checks: when a page read starts with "(This page is a bot check" it names the tool
  that clears it (`solve_turnstile` or `solve_recaptcha`). Call that tool once before
  anything else, including on Google's "unusual traffic" page, where the checkbox
  appears after a moment. Only if the check remains, or becomes a picture puzzle, hand
  the browser to the user or report it. Do not switch to another site or search engine
  to get around a check.

Fetching instead of browsing:
- Prefer `fetch_page` for static pages: articles, documentation, about/contact/pricing
  pages, directories, public listings and JSON endpoints. It is several times faster
  than `browse`, does not move your browser tab, and pages fetched earlier in the run
  come back instantly from a cache.
- When you have a list of sites or URLs to check (candidate companies, search results),
  call `fetch_many` once with all of them and `save_as` a JSON file, then read the file;
  do not `browse` them one by one.
- Use `browse` when you need to click, type, scroll, sign in or wait for content, for
  script-heavy apps (social networks, maps, dashboards, webmail), and whenever a fetch
  returns a 403, "bot check" or almost no text.
- `web_search` is an API call; it does not open a tab and never counts as using a site
  the user named.

Spending steps well (the user watches every step and pays for each one):
- Start a task of more than a few steps with `write_todos` and keep it current: it is
  the progress the user sees. Reconcile it before you finish.
- Never guess a site's URLs (its search page, catalog paths, product or category
  slugs). Open only URLs that `web_search`, `list_links` or a page read gave you. To
  look inside one site, use `web_search` with `site:<host> <words>` or browse its home
  page and use its own search box. A guessed URL that comes back 404 is a wasted step.
- A result that says a host is unreachable or skipped is final for this run: do not try
  that host again through another tool or path. Note it in your report instead.
- One pass per source: search, read the pages that matter once (`fetch_many` for a
  list, `extract_items` for a listing page), write down what you learned, move on. Do
  not re-read a page for a bigger excerpt unless it was cut off. For a comparison or
  survey, six to eight good sources are plenty; stop searching when new results repeat
  what you already have, and write the report.
"""

HANDOFF_PROMPT = """

Working with the user (they watch your browser live in the app and can take it over):
- When a page needs the user's own sign-in (password, one-time code, passkey) or shows
  a CAPTCHA you must not solve, call `hand_over_to_user` with a short reason written in
  the user's language. They act in the live browser and hand it back; then read the page
  again and continue. This replaces stopping and reporting for those cases.
- Never ask for a password or code in your messages, and never type one yourself.
- If the user does not come back in time, stop and report what is blocking you.
- For a decision only the user can make (which account to use, whether to send, post or
  submit something, a detail the request leaves out), call `ask_user` and carry on with
  the answer instead of ending your turn with a question. The run waits for them.
- Sending a message, posting, submitting a form (other than a search) and uploading a
  file are held for the user's approval automatically; the run waits for their answer.
  A result starting with "Not done" means they declined: do not look for another way to
  do it; carry on without it or stop and tell them.
"""


def with_user_handoff(tools: list, live: LiveScreencast) -> list:
    """Replace the engine's console-only CAPTCHA handoff with one tool that works through
    the live view, for CAPTCHAs and sign-ins alike (system_prompt() renames the engine's
    mentions of the old tool to it)."""
    from langchain_core.tools import tool

    @tool
    async def hand_over_to_user(reason: str) -> str:
        """Ask the user to take over the live browser, for example to sign in or solve a
        CAPTCHA, and wait until they hand it back. `reason` tells them what to do."""
        outcome = await live.wait_for_user(reason, HANDOFF_TIMEOUT_S)
        if outcome == 'returned':
            return ('The user finished and handed the browser back. Read the current page to '
                    'see what changed before continuing; do not assume they succeeded.')
        return (f'Nobody took over within {HANDOFF_TIMEOUT_S // 60} minutes. Stop and report '
                'what is blocking you.')

    return [t for t in tools if t.name != 'manual_captcha_handoff'] + [hand_over_to_user]


def role_prompt(role) -> str:
    """The part of the system prompt that tells the agent which role it works as."""
    if role is None:
        return ''
    prompt = f'\n\nYour role: you are {role.name}, {role.title}.'
    if role.instructions:
        prompt += f'\n{role.instructions.strip()}'
    return prompt


def system_prompt(role) -> str:
    """The engine's shared browsing rules, adapted to a run in the app: its CAPTCHA
    handoff is `hand_over_to_user` (with_user_handoff), then the role, the product's
    browsing rules and how to work with the user watching live."""
    from .engine.agent import SYSTEM_PROMPT

    shared = SYSTEM_PROMPT.replace('`manual_captcha_handoff`', '`hand_over_to_user`')
    return shared + role_prompt(role) + BROWSING_PROMPT + HANDOFF_PROMPT


def run_policy(run: AgentRun):
    """What the run may do without asking. A run comes in through the API and works on a
    signed-in profile, so it gets the general pack's policy for unwatched tasks: reading
    and downloading are free; sending, posting, submitting forms and uploading pause the
    run with an approve_action question (PolicyGuard's ask_human is human.ask_human)."""
    from .engine.packs import load_pack

    return load_pack('general').policy_for({'task': run.task}, background=True)


async def execute_run(run_id) -> None:
    """Run the agent for ``run_id`` until it finishes or asks the user something, starting
    where an earlier execution of the run stopped. Agent failures are recorded, not raised."""
    run = await _claim(run_id)
    if run is None:
        return

    from langgraph.errors import GraphRecursionError
    from langgraph.types import Command

    from .engine.agent import Usage, _text, build_agent, default_middleware
    from .engine.browser_tools import BrowserSession, make_browser_tools
    from .engine.human import ask_human, ask_user
    from .engine.policy import PolicyGuard

    recursion_limit = settings.AGENT_RECURSION_LIMIT
    config = {'configurable': {'thread_id': str(run.id)}, 'recursion_limit': recursion_limit}
    root = run_directory(run)
    workspace = root / 'workspace'
    workspace.mkdir(parents=True, exist_ok=True)

    session = BrowserSession.from_env()
    if run.profile_id:
        run.profile.directory.mkdir(parents=True, exist_ok=True)
        clear_stale_locks(run.profile.directory)
        session.profile_dir = str(run.profile.directory)
    else:
        # Throwaway profile so concurrent runs never fight over one Chromium profile.
        session.profile_dir = None

    usage = Usage()
    status, error, final_text = AgentRun.Status.SUCCEEDED, '', ''
    question, url = None, ''
    seq = await _next_seq(run.id)
    seen = 0
    live = LiveScreencast(session, run.id)
    heartbeat = asyncio.ensure_future(_keep_beating(run.id, session))
    try:
        async with open_checkpointer() as saver:
            await session.start()
            live.start()
            await session.verify_ip()
            tools = make_browser_tools(
                session, screenshot_dir=str(root / 'screenshots'), files_dir=str(workspace))
            tools = with_user_handoff(tools, live) + [ask_user]
            guard = PolicyGuard(run_policy(run), session, ask_human=ask_human)
            agent = build_agent(session, tools=tools, workspace=str(workspace), checkpointer=saver,
                                system_prompt=system_prompt(run.role),
                                middleware=[guard, *default_middleware(session)])

            snap = await agent.aget_state(config)
            done = list((snap.values or {}).get('messages', []))
            seen = len(done)
            if not done:
                step = {'messages': [{'role': 'user', 'content': run.task}]}
            elif snap.interrupts and not run.answer:
                # Its worker stopped after the question was asked but before the run was parked.
                step = None
                question = snap.interrupts[0].value
            elif snap.interrupts:
                answer = await _take_answer(run.id)
                seq = await _record_events(run.id, seq, [(AgentRunEvent.Kind.ANSWER, {'answer': _clip(answer)})])
                step = Command(resume={snap.interrupts[0].id: answer})
            else:
                step = None   # the worker died; carry on from the last finished step
            if done:
                final_text = _text(done[-1])
                await _reopen(session, run.last_url)

            async def consume():
                nonlocal seq, seen, final_text
                async for chunk in agent.astream(step, config=config, stream_mode='values'):
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

            if question is None:
                await asyncio.wait_for(consume(), settings.AGENT_RUN_TIMEOUT)
                snap = await agent.aget_state(config)
                if snap.interrupts:
                    question = snap.interrupts[0].value
            if question is not None:
                url = _page_url(session)
                seq = await _record_events(run.id, seq, [(AgentRunEvent.Kind.QUESTION, question)])
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
        heartbeat.cancel()
        await live.stop()
        try:
            await session.stop()
        except Exception:
            logger.exception('Stopping browser for run %s failed', run.id)

    await _collect_artifacts(run)
    totals = _usage_totals(run.usage, usage)
    if question is not None and status == AgentRun.Status.SUCCEEDED:
        await _pause(run.id, question, url, totals)
        return
    await _complete(run, status, final_text=final_text, error=error, usage=totals)


def purge_run_files(run: AgentRun) -> None:
    shutil.rmtree(run_directory(run), ignore_errors=True)
