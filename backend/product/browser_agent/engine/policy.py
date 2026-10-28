"""
What a task's agent may do without asking, and the middleware that enforces it.

A task pack declares a `Policy`. `PolicyGuard` sits between the model and the
tools: it classifies each page action by the element it targets and lets it
through, asks the user, or refuses. The element is looked up in the live page
(session.describe_element: its tag, type and form), with the label from the latest
page read when there is one:

- click on a send/reply/comment/connect control       -> may_send_messages
- click on a post/publish/share control               -> may_post
- click on submit/sign up/buy/delete/... controls, or
  on anything that submits a form (a submit button,
  whatever its label: "Continue", an icon, a CSS
  selector); Enter in a form field, or in a field
  outside a form that is not a search box             -> may_submit_forms
- upload_file                                         -> may_upload
- download_file                                       -> may_download

Search forms are free: a form marked role="search", one with a search field, or a
GET form without message, email, password, phone or file fields.

An action the policy does not allow pauses the task with an `approve_action`
question when the guard has `ask_human` (the worker, or a terminal prompt in the
CLI); without it (evals) the action is refused and the agent is told why.
`max_steps`, `max_cost_usd` and `rate_limits` are hard limits: past them tool calls
are refused and the agent is told to stop and report.

The prompt still tells the agent what not to do; this makes it hold even when the
prompt does not (an injected instruction, a confused model).
"""

from __future__ import annotations

import inspect
import re
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, ToolMessage

# Labels are matched from their start, case-insensitively, after trimming.
SEND_LABELS = re.compile(
    r"^(send|reply|reply all|forward|comment|post comment|send message|message send|"
    r"connect|invite|send invite|send request)\b", re.I)
POST_LABELS = re.compile(r"^(post|publish|share|tweet|repost|schedule|go live|boost)\b", re.I)
SUBMIT_LABELS = re.compile(
    # Not "apply", "order", "update": those also start "Apply filters", "Order by",
    # "Update results", which only change what a page shows.
    r"^(submit|sign up|signup|register|create account|join|apply now|apply for|place order|"
    r"buy|pay|checkout|check out|subscribe|confirm|delete|remove|unsubscribe|save|"
    r"continue to payment|request|book|reserve|donate|vote|follow|like)\b", re.I)
# A field whose Enter only runs a search.
SEARCH_FIELD = re.compile(r"search|query|find|look ?up|^q$|filter", re.I)
SEARCH_ROLES = {"searchbox", "combobox"}
# Fields that make a form more than a search: what it sends is a message or an identity.
WRITE_FIELDS = {"textarea", "email", "password", "tel", "file"}

_RATE = re.compile(r"^\s*(\d+)\s*(?:page loads?|loads?|requests?)?\s*/\s*(second|minute|hour|day)\s*$",
                   re.I)
_PERIOD_S = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


@dataclass(frozen=True)
class Policy:
    """Safe by default: a pack opts in to every kind of write."""
    may_submit_forms: bool = False     # search boxes are always fine
    may_send_messages: bool = False    # email, DM, comment, invitation
    may_post: bool = False             # public content
    may_download: bool = True
    may_upload: bool = False           # attach a file from the workspace to a page
    max_cost_usd: float | None = None
    max_steps: int | None = None       # tool calls in the whole task
    rate_limits: dict[str, str] = field(default_factory=dict)  # {"linkedin.com": "30 page loads / hour"}

    def __post_init__(self):
        for domain, rule in self.rate_limits.items():
            if not _RATE.match(rule):
                raise ValueError(f"rate limit for {domain}: expected 'N page loads / hour', got {rule!r}")

    def rate(self, host: str) -> tuple[str, int, int] | None:
        """(domain, count, seconds) of the limit that applies to `host`: one for the
        host itself or a parent domain. Loads are counted per that domain."""
        host = host.lower()
        for name, rule in self.rate_limits.items():
            if host == name or host.endswith("." + name):
                m = _RATE.match(rule)
                return name, int(m.group(1)), _PERIOD_S[m.group(2).lower()]
        return None


ALLOW_ALL = Policy(may_submit_forms=True, may_send_messages=True, may_post=True,
                   may_upload=True)

# What each permission is called in questions and refusals.
_WHAT = {"may_send_messages": "send messages", "may_post": "publish posts",
         "may_submit_forms": "submit forms", "may_download": "download files",
         "may_upload": "upload files"}
# Permissions that need the element looked up to decide.
_PAGE_WRITES = ("may_submit_forms", "may_send_messages", "may_post")


def is_search_form(el: dict) -> bool:
    fields = set(el.get("form_fields") or ())
    if el.get("form_role") == "search" or "search" in fields:
        return True
    return el.get("form_method") == "get" and not WRITE_FIELDS & fields


def submits_form(el: dict | None) -> bool:
    """`el` (from session.describe_element) is a control that submits its form."""
    if not el or not el.get("in_form"):
        return False
    tag, type_ = el.get("tag"), el.get("type", "")
    return (tag == "button" and type_ in ("", "submit")) or (
        tag == "input" and type_ in ("submit", "image"))


def is_enter(tool: str, args: dict) -> bool:
    return bool((tool == "type_text" and args.get("press_enter")) or (
        tool == "press_key" and str(args.get("key", "")).strip().lower() in ("enter", "return")))


def classify(tool: str, args: dict, label: str | None, role: str | None,
             element: dict | None = None) -> str | None:
    """The Policy permission a tool call needs, or None if it needs none.
    `label`/`role` describe the element the call targets (from the page read);
    `element` is what the live page says it is (session.describe_element; for a
    bare press_key('Enter'), the focused element), or None if unknown."""
    label = (label or (element or {}).get("label") or "").strip()
    role = (role or (element or {}).get("role") or "").lower()
    if tool == "download_file":
        return "may_download"
    if tool == "upload_file":
        return "may_upload"
    if tool == "click":
        if SEND_LABELS.search(label):
            return "may_send_messages"
        if POST_LABELS.search(label):
            return "may_post"
        if SUBMIT_LABELS.search(label) or role == "submit":
            return "may_submit_forms"
        if submits_form(element) and not is_search_form(element):
            return "may_submit_forms"
        return None
    if not is_enter(tool, args):
        return None
    if element and element.get("in_form"):
        return None if is_search_form(element) else "may_submit_forms"
    if (role in SEARCH_ROLES or (element or {}).get("type") == "search"
            or SEARCH_FIELD.search(label)):
        return None
    return "may_submit_forms"


def _cost(messages) -> float:
    return sum(float((m.response_metadata or {}).get("cost") or 0)
               for m in messages if isinstance(m, AIMessage))


class PolicyGuard(AgentMiddleware):
    """Enforces a Policy on tool calls. Put it right after EventLogger, so refused
    calls are still logged and nothing else runs for them."""

    def __init__(self, policy: Policy, session=None, ask_human=None):
        super().__init__()
        self.policy = policy
        self.session = session
        self.ask_human = ask_human
        self.loads: dict[str, list[float]] = {}   # domain -> page load times (this worker)

    def _target(self, args: dict) -> tuple[str | None, str | None]:
        element = args.get("element")
        if element is None:
            return None, None
        descs = getattr(self.session, "element_descs", {}) if self.session is not None else {}
        desc = descs.get(str(element))
        if desc:
            return desc[0], desc[1]
        return None, (None if str(element).isdigit() else str(element))

    def _refuse(self, request, text: str) -> ToolMessage:
        call = request.tool_call
        return ToolMessage(content=f"Not done: {text}", tool_call_id=call["id"],
                           name=call["name"], status="error")

    async def _approved(self, permission: str, describe: str) -> bool:
        if self.ask_human is None:
            return False
        answer = self.ask_human(
            "approve_action",
            f"The agent wants to {describe}. This task may not {_WHAT[permission]} "
            "without your approval. Allow it?", ["approve", "deny"])
        if inspect.isawaitable(answer):
            answer = await answer
        if isinstance(answer, dict):
            answer = answer.get("answer", "")
        return str(answer).strip().lower() in ("approve", "approved", "yes", "y", "allow", "ok")

    def _page_url(self) -> str:
        page = getattr(self.session, "page", None)
        try:
            return page.url if page is not None and not page.is_closed() else ""
        except Exception:
            return ""

    async def awrap_tool_call(self, request, handler):
        call = request.tool_call
        name, args = call["name"], call.get("args") or {}
        messages = (request.state or {}).get("messages", []) if isinstance(request.state, dict) \
            else getattr(request.state, "messages", [])
        p = self.policy

        if p.max_steps is not None:
            done = sum(isinstance(m, ToolMessage) for m in messages)
            if done >= p.max_steps:
                return self._refuse(request, f"this task's step budget ({p.max_steps} tool calls) "
                                             "is used up. Stop now and report what you have.")
        if p.max_cost_usd is not None and _cost(messages) >= p.max_cost_usd:
            return self._refuse(request, f"this task's cost budget (${p.max_cost_usd:.2f}) is used "
                                         "up. Stop now and report what you have.")

        if name == "browse" and args.get("url"):
            host = urlparse(str(args["url"])).hostname or ""
            limit = p.rate(host)
            if limit:
                domain, count, period = limit
                now = time.monotonic()
                recent = [t for t in self.loads.get(domain, []) if now - t < period]
                if len(recent) >= count:
                    return self._refuse(request, f"the rate limit for {domain} ({count} page "
                                                 f"loads per {period}s) is reached. Use what you "
                                                 "have, or stop and report.")
                self.loads[domain] = recent + [now]

        role, label = self._target(args)
        element = None
        # Look the element up when a page action could be a write this policy forbids.
        if (name == "click" or is_enter(name, args)) and not all(getattr(p, w) for w in _PAGE_WRITES):
            describe_element = getattr(self.session, "describe_element", None)
            if describe_element is not None:
                element = await describe_element(args.get("element"))
        permission = classify(name, args, label, role, element)
        if permission and not getattr(p, permission):
            label = label or (element or {}).get("label")
            role = role or (element or {}).get("tag")
            target = f'{role or "element"} "{label}"' if label else f"element {args.get('element')}"
            where = f" on {self._page_url()}" if self._page_url() else ""
            if name == "download_file":
                describe = f"download {args.get('url') or target}{where}"
            elif name == "click":
                describe = f"click {target}{where}"
            elif name == "upload_file":
                describe = f"upload {args.get('file_path')} to {target}{where}"
            else:
                describe = f"press Enter in {target}{where}"
            if not await self._approved(permission, describe):
                return self._refuse(
                    request, f"this task's policy does not allow it to {_WHAT[permission]} "
                             f"({describe}) and the user did not approve it. Do not look for "
                             "another way to do it; carry on with the task without it, or stop "
                             "and tell the user.")
        return await handler(request)
