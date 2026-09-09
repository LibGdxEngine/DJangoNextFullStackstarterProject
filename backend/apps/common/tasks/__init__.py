"""Shared background-task infrastructure.

``autodiscover_tasks()`` only imports ``<app>.tasks``, so every submodule that defines a
task must be imported here or the worker will never register it.
"""

from .base import RETRYABLE_EXCEPTIONS, BaseTask
from .cleanup import cleanup_expired_sessions, cleanup_task_records, cleanup_temp_uploads
from .exceptions import (
    ConcurrentExecutionError,
    PermanentTaskError,
    RetryableTaskError,
    TaskError,
)
from .health import BEAT_HEARTBEAT_CACHE_KEY, beat_heartbeat, ping
from .idempotency import IdempotencyGuard, build_key, idempotent, purge_expired_records
from .redaction import redact_call

__all__ = [
    "BaseTask",
    "RETRYABLE_EXCEPTIONS",
    "TaskError",
    "RetryableTaskError",
    "PermanentTaskError",
    "ConcurrentExecutionError",
    "IdempotencyGuard",
    "build_key",
    "idempotent",
    "purge_expired_records",
    "redact_call",
    "BEAT_HEARTBEAT_CACHE_KEY",
    "beat_heartbeat",
    "ping",
    "cleanup_expired_sessions",
    "cleanup_temp_uploads",
    "cleanup_task_records",
]
