"""Idempotency guard for background tasks.

Late acknowledgement means a task is delivered *at least* once: a worker that dies after
finishing its work but before acking will see the same message again. Any task with a
side effect that cannot be repeated safely (sending a message, charging a customer)
must wrap that side effect in :func:`idempotent`.

Two layers protect the side effect:

* a short-lived Redis lock, which stops two workers running the same key concurrently;
* a ``TaskExecution`` row, which remembers that the key already succeeded.
"""

import hashlib
import json
import logging
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .exceptions import ConcurrentExecutionError

logger = logging.getLogger(__name__)

LOCK_KEY_PREFIX = "task-lock"


def build_key(scope: str, *parts: Any) -> str:
    """Fingerprint a unit of work as a stable hex digest."""
    payload = json.dumps([scope, *parts], sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class IdempotencyGuard:
    """Context manager that lets a unit of work succeed at most once per key."""

    def __init__(
        self,
        key: str,
        *,
        task_name: str = "",
        task_id: str = "",
        ttl: int | None = None,
        lock_timeout: int | None = None,
    ) -> None:
        self.key = key
        self.task_name = task_name
        self.task_id = task_id or ""
        self.ttl = settings.TASK_IDEMPOTENCY_TTL if ttl is None else ttl
        self.lock_timeout = settings.TASK_LOCK_TIMEOUT if lock_timeout is None else lock_timeout
        self.is_duplicate = False
        self.result: Any = None
        self._execution = None
        self._lock_acquired = False

    @property
    def _lock_key(self) -> str:
        return f"{LOCK_KEY_PREFIX}:{self.key}"

    def record(self, result: Any = None) -> None:
        """Store the value to replay on a later duplicate delivery."""
        self.result = result

    def __enter__(self) -> "IdempotencyGuard":
        from apps.common.models import TaskExecution

        self._lock_acquired = cache.add(self._lock_key, self.task_id or "1", self.lock_timeout)
        if not self._lock_acquired:
            raise ConcurrentExecutionError(
                f"Idempotency key {self.key} is already being processed by another worker"
            )

        try:
            now = timezone.now()
            execution, created = TaskExecution.objects.get_or_create(
                key=self.key,
                defaults={
                    "task_name": self.task_name,
                    "task_id": self.task_id,
                    "status": TaskExecution.Status.RUNNING,
                    "expires_at": now + timedelta(seconds=self.ttl),
                },
            )
            if not created:
                if execution.status == TaskExecution.Status.SUCCEEDED and execution.expires_at > now:
                    self.is_duplicate = True
                    self.result = execution.result
                    logger.info(
                        "Skipping duplicate execution of %s for key %s", self.task_name, self.key
                    )
                    return self
                # Previous attempt failed or aged out, so this delivery may run again.
                execution.task_id = self.task_id
                execution.status = TaskExecution.Status.RUNNING
                execution.expires_at = now + timedelta(seconds=self.ttl)
                execution.save(update_fields=["task_id", "status", "expires_at", "updated_at"])
            self._execution = execution
        except Exception:
            self._release()
            raise
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        from apps.common.models import TaskExecution

        try:
            if self.is_duplicate or self._execution is None:
                return False
            if exc_type is None:
                self._execution.status = TaskExecution.Status.SUCCEEDED
                self._execution.result = self.result
            else:
                self._execution.status = TaskExecution.Status.FAILED
            self._execution.save(update_fields=["status", "result", "updated_at"])
        finally:
            self._release()
        return False

    def _release(self) -> None:
        if self._lock_acquired:
            cache.delete(self._lock_key)
            self._lock_acquired = False


def idempotent(
    key: str,
    *,
    task_name: str = "",
    task_id: str = "",
    ttl: int | None = None,
    lock_timeout: int | None = None,
) -> IdempotencyGuard:
    """Guard a side effect so it happens at most once for ``key``.

    Usage::

        with idempotent(key) as guard:
            if guard.is_duplicate:
                return guard.result
            guard.record(do_the_work())
            return guard.result
    """
    return IdempotencyGuard(
        key, task_name=task_name, task_id=task_id, ttl=ttl, lock_timeout=lock_timeout
    )


def purge_expired_records(now=None) -> int:
    """Drop idempotency records whose suppression window has passed."""
    from apps.common.models import TaskExecution

    deleted, _ = TaskExecution.objects.filter(expires_at__lt=now or timezone.now()).delete()
    return deleted
