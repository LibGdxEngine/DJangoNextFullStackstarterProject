"""Find companies and contacts matching a profile and return a reviewed list.

Read-only: the agent searches, reads company sites and writes leads.json in its
workspace. It never fills in contact forms, sends messages or signs up, and never
guesses an email address.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ...policy import Policy

DESCRIPTION = "Find companies and contacts that match an ideal-customer profile."


class Input(BaseModel):
    ideal_customer: str = Field(min_length=3, description="who to find, in plain words")
    roles: list[str] = Field(default_factory=list, description="contact titles to look for")
    count: int = Field(10, ge=1, le=200, description="how many leads at most")
    sources: list[str] = Field(default_factory=lambda: ["web", "company_sites"])
    start_urls: list[str] = Field(default_factory=list,
                                  description="directories or lists to start from")
    exclude_domains: list[str] = Field(default_factory=list)


class Output(BaseModel):
    """One row of leads.json."""
    company: str
    website: str
    what_they_do: str
    contact_name: str | None = None
    title: str | None = None
    profile_url: str | None = None
    email: str | None = None
    email_source: str | None = Field(
        None, description="the URL the email was read from; required when email is set")
    source_urls: list[str]
    confidence: Literal["high", "medium", "low"]

    @model_validator(mode="after")
    def _email_has_source(self):
        if self.email and not self.email_source:
            raise ValueError(f"email {self.email!r} has no email_source")
        return self


OUTPUT_FILE = "leads.json"

TOOLS = (
    "browse", "web_search", "read_current_page", "find_on_page", "list_links",
    "extract_items", "scroll", "wait_for", "go_back", "click", "type_text", "press_key",
    "dismiss_overlays", "download_file", "read_pdf", "list_tabs", "switch_tab",
    "close_tab", "manual_captcha_handoff", "solve_turnstile",
)

ALLOWED_DOMAINS = ()  # research reaches any site; the rate limits below still apply


def POLICY(input: Input) -> Policy:
    return Policy(
        may_submit_forms=False, may_send_messages=False, may_post=False, may_download=True,
        max_cost_usd=round(0.5 + 0.15 * input.count, 2),
        max_steps=20 + 10 * input.count,
        rate_limits={"linkedin.com": "30 page loads / hour"},
    )


def task(input: Input) -> str:
    lines = [f"Find up to {input.count} companies that match this profile: "
             f"{input.ideal_customer}."]
    if input.roles:
        lines.append(f"For each company, find a person in one of these roles: "
                     f"{', '.join(input.roles)}.")
    if input.start_urls:
        lines.append("Start from: " + ", ".join(input.start_urls) + ".")
    lines.append(f"Sources you may use: {', '.join(input.sources)}.")
    if input.exclude_domains:
        lines.append("Leave out these companies' domains: " + ", ".join(input.exclude_domains) + ".")
    lines.append(f"Write the leads to {OUTPUT_FILE} as described in your instructions, then "
                 "answer with a short summary: how many leads, what you searched, and what "
                 "you skipped and why.")
    return "\n".join(lines)
