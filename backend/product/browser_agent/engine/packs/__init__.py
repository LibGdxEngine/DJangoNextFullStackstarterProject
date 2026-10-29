"""
Task packs: one folder per kind of task, so adding a task is adding a folder.

    packs/<name>/
        pack.py         DESCRIPTION, Input (pydantic), task(input) -> str, and optionally
                        Output (pydantic, one row of OUTPUT_FILE), OUTPUT_FILE, TOOLS
                        (browser tool names; None = all), ALLOWED_DOMAINS, POLICY (a
                        Policy, or a function of the input that returns one), and
                        BACKGROUND_POLICY: the same, for tasks the worker runs while
                        nobody watches (default: POLICY)
        prompt.md       what this task adds to the shared browsing rules (optional)
        connectors.py   make_tools(session, workspace) -> list of API tools (optional)
        scenarios.py    SCENARIOS: evals for the pack, run by `python -m evals` (required
                        for every pack but `general`: a pack with no evals is not done)

This module only reads pack folders; it imports nothing heavy, so the API can
validate inputs without loading the browser.
"""

from __future__ import annotations

import importlib
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel, TypeAdapter, ValidationError

from ..policy import Policy

PACKS_DIR = Path(__file__).parent


@dataclass(frozen=True)
class Pack:
    name: str
    description: str
    input_schema: type[BaseModel]
    make_task: Callable[[BaseModel], str]
    prompt: str = ""
    output_schema: type[BaseModel] | None = None
    output_file: str = ""
    tools: tuple[str, ...] | None = None
    allowed_domains: tuple[str, ...] = ()
    policy: Policy | Callable[[BaseModel], Policy] = Policy()
    background_policy: Policy | Callable[[BaseModel], Policy] | None = None
    make_connectors: Callable | None = None

    def parse_input(self, data: dict) -> BaseModel:
        """The validated input; raises pydantic.ValidationError."""
        return self.input_schema.model_validate(data)

    def task_text(self, data: dict) -> str:
        return self.make_task(self.parse_input(data))

    def policy_for(self, data: dict, background: bool = False) -> Policy:
        """The policy for this input; `background` for a task the worker runs."""
        policy = self.policy
        if background and self.background_policy is not None:
            policy = self.background_policy
        if isinstance(policy, Policy):
            return policy
        return policy(self.parse_input(data))

    def system_prompt(self, shared: str) -> str:
        """The shared browsing rules followed by this pack's own part."""
        return shared + ("\n\n" + self.prompt.strip() + "\n" if self.prompt.strip() else "")

    def select_tools(self, tools: list) -> list:
        if self.tools is None:
            return list(tools)
        return [t for t in tools if t.name in self.tools]

    def connector_tools(self, session, workspace: str) -> list:
        return list(self.make_connectors(session, workspace)) if self.make_connectors else []

    def read_output(self, workspace: str | Path) -> tuple[Any, str]:
        """(rows, "") from OUTPUT_FILE checked against Output, or (None, problem)."""
        if not self.output_file:
            return None, ""
        path = Path(workspace) / self.output_file
        if not path.exists():
            return None, f"{self.output_file} was not written"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            return None, f"{self.output_file} is not valid JSON: {e}"
        if self.output_schema is None:
            return data, ""
        try:
            rows = TypeAdapter(list[self.output_schema]).validate_python(data)
        except ValidationError as e:
            return data, f"{self.output_file} does not match the output schema: {e}"
        return [r.model_dump() for r in rows], ""


class UnknownPack(KeyError):
    pass


def pack_names() -> list[str]:
    return sorted(p.name for p in PACKS_DIR.iterdir()
                  if p.is_dir() and (p / "pack.py").exists() and not p.name.startswith("_"))


@lru_cache(maxsize=None)
def load_pack(name: str) -> Pack:
    if name not in pack_names():
        raise UnknownPack(f"no task pack {name!r}; known packs: {', '.join(pack_names())}")
    mod = importlib.import_module(f"{__name__}.{name}.pack")
    folder = PACKS_DIR / name
    prompt_file = folder / "prompt.md"
    connectors = None
    if (folder / "connectors.py").exists():
        connectors = importlib.import_module(f"{__name__}.{name}.connectors").make_tools
    tools = getattr(mod, "TOOLS", None)
    return Pack(
        name=name,
        description=mod.DESCRIPTION,
        input_schema=mod.Input,
        make_task=mod.task,
        prompt=prompt_file.read_text(encoding="utf-8") if prompt_file.exists() else "",
        output_schema=getattr(mod, "Output", None),
        output_file=getattr(mod, "OUTPUT_FILE", ""),
        tools=None if tools is None else tuple(tools),
        allowed_domains=tuple(getattr(mod, "ALLOWED_DOMAINS", ())),
        policy=getattr(mod, "POLICY", Policy()),
        background_policy=getattr(mod, "BACKGROUND_POLICY", None),
        make_connectors=connectors,
    )


def pack_scenarios() -> list:
    """Every pack's eval scenarios (packs/<name>/scenarios.py), tagged with the pack."""
    out = []
    for name in pack_names():
        if (PACKS_DIR / name / "scenarios.py").exists():
            mod = importlib.import_module(f"{__name__}.{name}.scenarios")
            out.extend(mod.SCENARIOS)
    return out
