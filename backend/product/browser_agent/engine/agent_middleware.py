"""
Middleware that keeps the browsing agent from going in circles.

- RepeatGuard notices when the agent repeats a browser action it already tried this
  turn and tells it so, with what happened the first time.
- TrimOldSnapshots shrinks old page snapshots in what the model sees to their URL and
  title, so the recent steps stand out and input tokens stay low. The checkpointed
  history is left complete.
- StepTimer records how long every model call and tool call took, on the messages
  themselves, so a run can be split into model time and browser time.
- model_retry() retries a model call that failed for a passing reason (rate limit,
  OpenRouter's "could not verify credits in time", a 5xx), never a real error such
  as an exhausted balance.
"""

from __future__ import annotations

import json
import time
from urllib.parse import urldefrag

from langchain.agents.middleware import AgentMiddleware, ModelRetryMiddleware
from langchain_core.messages import AIMessage, ToolMessage

from .browser_tools import BrowserSession

# Tools whose repeats are worth pointing out. Reads, waits and scrolls are left out:
# repeating those is normal while a page loads.
TRACKED_TOOLS = {
    "browse", "click", "type_text", "set_checkbox", "select_option", "hover",
    "press_key", "find_on_page", "list_links", "web_search", "download_file",
    "switch_tab", "dismiss_overlays", "drag",
}
# Tools whose result depends on the page they run on, so the URL is part of the key.
PAGE_TOOLS = TRACKED_TOOLS - {"browse", "web_search", "download_file", "switch_tab"}


def _outcome(content: str) -> str:
    """One line saying what a tool call led to: the page it ended on, or its message."""
    lines = [line.strip() for line in content.splitlines()[:8] if line.strip()]
    if not lines:
        return "(empty result)"
    page = [line for line in lines if line.startswith(("URL:", "Title:"))]
    first = [] if lines[0].startswith("URL:") else [lines[0]]
    return " | ".join(first + page)[:200]


class RepeatGuard(AgentMiddleware):
    """Adds a note to a tool result when the same action was already tried."""

    def __init__(self, session: BrowserSession):
        super().__init__()
        self.session = session
        self.step = 0
        self.seen: dict[str, list[tuple[int, str]]] = {}

    async def abefore_agent(self, state, runtime):
        # Each user turn (including chat follow-ups) starts with a clean log.
        self.step = 0
        self.seen.clear()
        return None

    def _key(self, name: str, args: dict) -> tuple[str, str]:
        call = f"{name}({', '.join(f'{k}={v!r}' for k, v in sorted(args.items()))})"
        key = name + json.dumps(args, sort_keys=True, default=str)
        where = ""
        if name in PAGE_TOOLS and self.session.page and not self.session.page.is_closed():
            where = urldefrag(self.session.page.url)[0]
            key += " @ " + where
        return key, call + (f" on {where}" if where else "")

    async def awrap_tool_call(self, request, handler):
        self.step += 1
        step = self.step
        name = request.tool_call["name"]
        if name not in TRACKED_TOOLS:
            return await handler(request)
        key, call = self._key(name, request.tool_call.get("args") or {})
        result = await handler(request)
        if not isinstance(result, ToolMessage) or not isinstance(result.content, str):
            return result
        before = self.seen.setdefault(key, [])
        before.append((step, _outcome(result.content)))
        if len(before) == 1:
            return result
        first_step, first_outcome = before[0]
        note = (f"Note: you already ran {call} at step {first_step} and got: {first_outcome}. "
                "Repeating it won't help unless the page changed; try a different approach.")
        if len(before) >= 3:
            note += (f" This is attempt {len(before)}. If nothing else works, stop and "
                     "report what you tried.")
        return result.model_copy(update={"content": note + "\n\n" + result.content})


class TrimOldSnapshots(AgentMiddleware):
    """Shows the model only the URL/title of page snapshots older than the last `keep`
    tool results. Other long results are cut to `max_chars`."""

    def __init__(self, keep: int = 4, max_chars: int = 4000):
        super().__init__()
        self.keep = keep
        self.max_chars = max_chars

    def _shrink(self, content) -> str | None:
        """The trimmed content, or None to leave the message as it is."""
        if isinstance(content, list):  # a vision screenshot
            text = " ".join(p.get("text", "") for p in content
                            if isinstance(p, dict) and p.get("type") == "text")
            return (text + " [screenshot omitted]").strip()
        lines = content.splitlines()
        url_at = next((i for i, line in enumerate(lines[:8]) if line.startswith("URL: ")), None)
        if url_at is not None:
            notes = [line[:200] for line in lines[:url_at] if line.strip()][-3:]
            header = []
            for line in lines[url_at:]:
                if not line.strip():
                    break
                header.append(line)
            return "\n".join(notes + header +
                             ["[page text trimmed; call read_current_page to see it again]"])
        if len(content) > self.max_chars:
            return content[:self.max_chars] + "\n...[trimmed]"
        return None

    async def awrap_model_call(self, request, handler):
        tool_at = [i for i, m in enumerate(request.messages) if isinstance(m, ToolMessage)]
        old = tool_at[:-self.keep] if self.keep else tool_at
        if not old:
            return await handler(request)
        messages = list(request.messages)
        for i in old:
            shrunk = self._shrink(messages[i].content)
            if shrunk is not None and shrunk != messages[i].content:
                messages[i] = messages[i].model_copy(update={"content": shrunk})
        return await handler(request.override(messages=messages))


class StepTimer(AgentMiddleware):
    """Times each model call and tool call. The model's time lands in the AIMessage's
    `response_metadata["llm_s"]` (with `prompt_chars`, the size of what it was sent);
    the tool's in the ToolMessage's `additional_kwargs["tool_s"]`, plus `waits`: the
    fixed waits the browser spent inside it, as (name, seconds). Nothing the model
    sees changes, so it is safe to keep on in every experiment."""

    def __init__(self, session: BrowserSession | None = None):
        super().__init__()
        self.session = session

    async def abefore_agent(self, state, runtime):
        if self.session is not None:
            self.session.waits.clear()
        return None

    async def awrap_model_call(self, request, handler):
        t0 = time.monotonic()
        response = await handler(request)
        seconds = round(time.monotonic() - t0, 3)
        chars = sum(len(m.content) if isinstance(m.content, str) else len(str(m.content))
                    for m in request.messages)
        messages = getattr(response, "result", None)
        if messages is None:
            messages = [response]
        for msg in messages:
            if isinstance(msg, AIMessage):
                msg.response_metadata["llm_s"] = seconds
                msg.response_metadata["prompt_chars"] = chars
        return response

    async def awrap_tool_call(self, request, handler):
        # Browser tools run one at a time (session.lock), so the waits appended
        # while this call ran are its own.
        start = len(self.session.waits) if self.session is not None else 0
        t0 = time.monotonic()
        result = await handler(request)
        if isinstance(result, ToolMessage):
            result.additional_kwargs["tool_s"] = round(time.monotonic() - t0, 3)
            if self.session is not None:
                result.additional_kwargs["waits"] = [
                    (name, round(s, 3)) for name, s in self.session.waits[start:]]
        return result


def _transient(exc: Exception) -> bool:
    name = type(exc).__name__
    status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None),
                                                          "status_code", None)
    return ("TooManyRequests" in name or "RateLimit" in name or "Timeout" in name
            or status in (408, 429, 500, 502, 503, 504))


def model_retry() -> ModelRetryMiddleware:
    """Up to 3 retries, 5 s then 10 s then 20 s apart; after that the error is raised."""
    return ModelRetryMiddleware(max_retries=3, retry_on=_transient, on_failure="error",
                                initial_delay=5.0, max_delay=60.0)
