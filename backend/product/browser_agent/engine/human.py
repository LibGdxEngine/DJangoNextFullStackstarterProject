"""
Steps that need a person, as a pause in the run instead of a terminal prompt.

`ask_human` stops the agent's graph with a LangGraph interrupt. The runner sees the
interrupt, moves the run to `waiting` with the question, and resumes the graph with
the user's answer, which `ask_human` then returns. The tool that asked runs again
from its start on resume, so anything before the `ask_human` call in it must be safe
to repeat.

Only usable inside a graph with a checkpointer.
"""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
from langgraph.types import interrupt

HUMAN_KINDS = ("captcha", "choose_account", "approve_action", "clarify")


def ask_human(kind: str, question: str, options: list[str] | None = None) -> Any:
    """Pause the run until the user answers `question`; returns the answer."""
    if kind not in HUMAN_KINDS:
        raise ValueError(f"unknown kind {kind!r}; expected one of {HUMAN_KINDS}")
    return interrupt({"kind": kind, "question": question, "options": options or []})


def describe_answer(answer: Any) -> str:
    if isinstance(answer, dict) and set(answer) == {"answer"}:
        answer = answer["answer"]
    return answer if isinstance(answer, str) else repr(answer)


@tool
async def ask_user(question: str, kind: str = "clarify",
                   options: list[str] | None = None) -> str:
    """Ask the user a question and wait for the answer. Use it whenever your
    instructions say to stop and ask, and for decisions only the user can make:
    which account to use (kind="choose_account"), approving a send, post or other
    irreversible action (kind="approve_action"), or a missing detail
    (kind="clarify"). `options` lists the choices, if there are any."""
    if kind not in HUMAN_KINDS or kind == "captcha":
        kind = "clarify"
    answer = ask_human(kind, question, options)
    return f"The user answered: {describe_answer(answer)}"
