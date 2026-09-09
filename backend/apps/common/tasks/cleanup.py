"""Scheduled maintenance sweeps.

Deletes are naturally idempotent: a second run simply finds nothing left to remove, so
these tasks need no idempotency guard.
"""

import logging
from datetime import timedelta
from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .idempotency import purge_expired_records

logger = logging.getLogger(__name__)


@shared_task(name="apps.common.tasks.cleanup_expired_sessions")
def cleanup_expired_sessions():
    """Remove Django sessions whose expiry has passed."""
    from django.contrib.sessions.models import Session

    deleted, _ = Session.objects.filter(expire_date__lt=timezone.now()).delete()
    logger.info("Deleted %s expired sessions", deleted)
    return deleted


@shared_task(name="apps.common.tasks.cleanup_temp_uploads")
def cleanup_temp_uploads():
    """Delete abandoned files under ``MEDIA_ROOT/tmp`` older than the retention window."""
    temp_root = Path(settings.MEDIA_ROOT) / "tmp"
    if not temp_root.is_dir():
        return 0

    cutoff = (timezone.now() - timedelta(hours=settings.TEMP_UPLOAD_RETENTION_HOURS)).timestamp()
    removed = 0
    for path in temp_root.rglob("*"):
        # Symlinks are skipped so a planted link cannot delete files outside the temp root.
        if path.is_symlink() or not path.is_file():
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError as exc:
            logger.warning("Could not delete temp upload %s: %s", path, exc)

    logger.info("Deleted %s abandoned temp uploads", removed)
    return removed


@shared_task(name="apps.common.tasks.cleanup_task_records")
def cleanup_task_records():
    """Trim the idempotency ledger and already-triaged dead-letter entries."""
    from apps.common.models import FailedTask

    expired_keys = purge_expired_records()

    cutoff = timezone.now() - timedelta(days=settings.TASK_RECORD_RETENTION_DAYS)
    # Entries still marked NEW are kept: nobody has triaged them yet.
    deleted_failures, _ = FailedTask.objects.filter(
        created_at__lt=cutoff,
        status__in=[FailedTask.Status.REQUEUED, FailedTask.Status.IGNORED],
    ).delete()

    logger.info(
        "Pruned %s idempotency records and %s dead-letter entries", expired_keys, deleted_failures
    )
    return {"idempotency_records": expired_keys, "dead_letters": deleted_failures}
