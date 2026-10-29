"""Any browsing task, in the user's own words: what `python agent.py "..."` runs.

In the CLI everything is allowed, as before packs existed: the user is watching,
and the shared prompt's rules (ask before sending, never type passwords, ...) hold
the agent back. A background task (worker.py) can come from anyone who reaches the
API and runs on the signed-in profile with nobody watching, so there every send,
post, form submission and upload waits for the user's approval.
"""

from pydantic import BaseModel, Field

from ...policy import ALLOW_ALL, Policy

DESCRIPTION = "Any browsing task, described in plain words."


class Input(BaseModel):
    task: str = Field(min_length=1)


def task(input: Input) -> str:
    return input.task


POLICY = ALLOW_ALL
BACKGROUND_POLICY = Policy(may_submit_forms=False, may_send_messages=False, may_post=False,
                           may_upload=False, may_download=True)
