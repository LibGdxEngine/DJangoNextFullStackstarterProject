"""Keeps secrets such as OTP codes out of dead-letter rows and log lines."""

import inspect
from typing import Any, Iterable, Mapping

REDACTED = "***"

SENSITIVE_NAMES = frozenset(
    {
        "code",
        "otp",
        "password",
        "new_password",
        "old_password",
        "current_password",
        "token",
        "access_token",
        "refresh_token",
        "secret",
        "signing_secret",
        "api_key",
        "signature",
        "authorization",
    }
)


def _parameter_names(task: Any) -> list[str]:
    """Positional parameter names of the task body, without the bound ``self``."""
    try:
        names = list(inspect.signature(task.run).parameters)
    except (TypeError, ValueError, AttributeError):
        return []
    if names and names[0] == "self":
        names = names[1:]
    return names


def _sanitize(value: Any, sensitive: frozenset[str]) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        return {
            str(key): REDACTED if str(key).lower() in sensitive else _sanitize(item, sensitive)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [_sanitize(item, sensitive) for item in value]
    return repr(value)


def redact_call(
    task: Any,
    args: Iterable[Any] | None,
    kwargs: Mapping[str, Any] | None,
    extra_names: Iterable[str] = (),
) -> tuple[list[Any], dict[str, Any]]:
    """Return JSON-safe copies of a task's arguments with sensitive values masked.

    Positional arguments are matched to parameter names via the task signature, so a
    secret passed positionally is redacted just like a keyword one.
    """
    sensitive = frozenset(
        SENSITIVE_NAMES
        | {name.lower() for name in extra_names}
        | {name.lower() for name in getattr(task, "sensitive_args", ())}
    )

    names = _parameter_names(task)
    safe_args: list[Any] = []
    for index, value in enumerate(args or ()):
        name = names[index].lower() if index < len(names) else ""
        safe_args.append(REDACTED if name in sensitive else _sanitize(value, sensitive))

    safe_kwargs = {
        str(key): REDACTED if str(key).lower() in sensitive else _sanitize(value, sensitive)
        for key, value in (kwargs or {}).items()
    }
    return safe_args, safe_kwargs
