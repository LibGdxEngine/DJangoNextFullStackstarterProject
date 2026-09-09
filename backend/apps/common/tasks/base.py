"""Default base class for every background task in the project.

Registered globally via ``Celery(task_cls=...)`` in ``core/celery.py``, so plain
``@shared_task`` functions inherit late acknowledgement, bounded retries with backoff,
and dead-letter capture without opting in.
"""

import logging

import httpx
import requests
from django.conf import settings

from .exceptions import RetryableTaskError
from .idempotency import build_key
from .redaction import redact_call

logger = logging.getLogger(__name__)

try:  # celery>=5.4 ships a Django-aware Task offering delay_on_commit()
    from celery.contrib.django.task import DjangoTask as _CeleryBaseTask
except ImportError:  # pragma: no cover - older celery
    from celery import Task as _CeleryBaseTask


# Only transport-level problems are retried. Application errors such as an HTTP 4xx or a
# validation failure will never succeed on a retry, so they fail fast into the dead letter.
RETRYABLE_EXCEPTIONS = (
    RetryableTaskError,
    OSError,  # covers ConnectionError, TimeoutError and socket errors
    httpx.TransportError,
    requests.ConnectionError,
    requests.Timeout,
)


class BaseTask(_CeleryBaseTask):
    """Task base with retry, timeout and failure-capture policy applied."""

    autoretry_for = RETRYABLE_EXCEPTIONS
    max_retries = settings.TASK_MAX_RETRIES
    retry_backoff = settings.TASK_RETRY_BACKOFF
    retry_backoff_max = settings.TASK_RETRY_BACKOFF_MAX
    retry_jitter = True
    acks_late = True
    track_started = True

    #: Extra parameter names to mask before arguments are logged or dead-lettered.
    sensitive_args: tuple[str, ...] = ()

    def idempotency_key(self, *parts) -> str:
        """Fingerprint this task's unit of work, namespaced by task name."""
        return build_key(self.name, *parts)

    def on_retry(self, exc, task_id, args, kwargs, einfo):
        logger.warning(
            "Retrying %s [%s] (attempt %s/%s) after %s: %s",
            self.name,
            task_id,
            self.request.retries + 1,
            self.max_retries,
            type(exc).__name__,
            exc,
        )
        super().on_retry(exc, task_id, args, kwargs, einfo)

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        logger.error(
            "Task %s [%s] failed permanently after %s retries: %s",
            self.name,
            task_id,
            self.request.retries,
            exc,
        )
        self._record_dead_letter(exc, task_id, args, kwargs, einfo)
        super().on_failure(exc, task_id, args, kwargs, einfo)

    def _record_dead_letter(self, exc, task_id, args, kwargs, einfo):
        # Imported late: models are not loadable when the task class is first resolved.
        from apps.common.models import FailedTask

        try:
            safe_args, safe_kwargs = redact_call(self, args, kwargs)
            delivery_info = getattr(self.request, "delivery_info", None) or {}
            FailedTask.objects.create(
                task_name=self.name,
                task_id=str(task_id or ""),
                queue=str(delivery_info.get("routing_key") or ""),
                args=safe_args,
                kwargs=safe_kwargs,
                exception_class=type(exc).__name__,
                exception_message=str(exc)[:2000],
                traceback=str(einfo)[:20000] if einfo else "",
                retries=self.request.retries or 0,
            )
        except Exception:  # never let dead-lettering mask the original failure
            logger.exception("Could not dead-letter task %s [%s]", self.name, task_id)
