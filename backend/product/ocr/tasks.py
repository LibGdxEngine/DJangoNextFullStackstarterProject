import hashlib
import hmac
import json
import logging
import os
import random
import re
import uuid
from datetime import timedelta

from celery import Task, shared_task
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .gpu import ModelError, run_model
from .models import OCRJob, OCRUploadReservation, OCRWebhookEvent
from .processing import validate_document
from .security import deliver_webhook
from .services import finish_job, signing_secret
from .uploads import delete_upload

logger = logging.getLogger(__name__)


@shared_task(base=Task, queue="ocr", acks_late=True, reject_on_worker_lost=False,
             autoretry_for=(), max_retries=0, soft_time_limit=1000, time_limit=1050)
def process_job(job_id):
    if not settings.OCR_ENABLED:
        return
    token = uuid.uuid4()
    with transaction.atomic():
        job = OCRJob.objects.select_for_update().filter(pk=job_id).first()
        if job is None or job.status != OCRJob.Status.QUEUED:
            return
        job.status = OCRJob.Status.PROCESSING
        job.lease_token = token
        job.lease_expires_at = timezone.now() + timedelta(seconds=settings.OCR_JOB_LEASE_SECONDS)
        job.save(update_fields=["status", "lease_token", "lease_expires_at", "updated_at"])
    result = None
    error_code = ""
    model_started = False
    try:
        validate_document(job.storage_name, job.content_type)
        model_started = True
        result = run_model(job.storage_name, job.content_type, str(job.id))
    except ModelError as exc:
        error_code = exc.code
    except Exception as exc:
        # Validation codes are public constants; never expose parser or upstream text.
        code = getattr(exc, "code", "")
        error_code = code if code in {"invalid_document", "unsafe_document", "scanner_unavailable"} else ("model_outcome_unknown" if model_started else "ocr_processing_failed")
        logger.warning("OCR job %s stopped (%s)", job_id, error_code)
    with transaction.atomic():
        current = OCRJob.objects.select_for_update().get(pk=job_id)
        if current.status != OCRJob.Status.PROCESSING or current.lease_token != token:
            return
        finish_job(current, OCRJob.Status.FAILED if error_code else OCRJob.Status.SUCCEEDED,
                   result=result if not error_code else None, error_code=error_code)
    cleanup_source(job_id)


def cleanup_source(job_id):
    job = OCRJob.objects.filter(pk=job_id).exclude(storage_name="").first()
    if not job or job.status in [OCRJob.Status.QUEUED, OCRJob.Status.PROCESSING]:
        return
    try:
        delete_upload(job.storage_name)
    except OSError:
        logger.warning("OCR source cleanup will retry for job %s", job_id)
        return
    OCRJob.objects.filter(pk=job_id, storage_name=job.storage_name).update(storage_name="")


@shared_task(base=Task, queue="maintenance", autoretry_for=(), soft_time_limit=50, time_limit=60)
def dispatch_jobs():
    if not settings.OCR_ENABLED:
        return
    now = timezone.now()
    candidates = OCRJob.objects.filter(status=OCRJob.Status.QUEUED).filter(
        Q(dispatch_after__isnull=True) | Q(dispatch_after__lte=now),
    ).values_list("id", flat=True)[:100]
    for job_id in list(candidates):
        with transaction.atomic():
            job = OCRJob.objects.select_for_update().get(pk=job_id)
            if job.status != OCRJob.Status.QUEUED or (job.dispatch_after and job.dispatch_after > now):
                continue
            job.dispatch_after = now + timedelta(seconds=settings.OCR_JOB_LEASE_SECONDS)
            job.save(update_fields=["dispatch_after", "updated_at"])
        try:
            process_job.apply_async(args=[str(job_id)], queue="ocr")
        except Exception:
            logger.warning("OCR dispatch deferred for job %s", job_id)


@shared_task(base=Task, queue="ocr-webhooks", autoretry_for=(), max_retries=0,
             acks_late=True, soft_time_limit=50, time_limit=60)
def deliver_event(event_id):
    now = timezone.now()
    token = uuid.uuid4()
    with transaction.atomic():
        event = OCRWebhookEvent.objects.select_for_update().select_related("job").filter(pk=event_id).first()
        if not event or event.status != OCRWebhookEvent.Status.PENDING or event.next_attempt_at > now:
            return
        if event.attempts >= settings.OCR_WEBHOOK_MAX_ATTEMPTS:
            event.status = OCRWebhookEvent.Status.FAILED
            event.save(update_fields=["status", "updated_at"])
            return
        event.status = OCRWebhookEvent.Status.SENDING
        event.lease_token = token
        event.lease_expires_at = now + timedelta(seconds=120)
        event.attempts += 1
        event.save()
    body = json.dumps(event.payload, separators=(",", ":"), sort_keys=True).encode()
    timestamp = str(int(now.timestamp()))
    signature = hmac.new(signing_secret(event.job.api_key_id).encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    status_code = None
    try:
        status_code = deliver_webhook(event.job.webhook_url, body, {
            "Content-Type": "application/json", "X-OCR-Event-ID": str(event.id),
            "X-OCR-Timestamp": timestamp, "X-OCR-Signature": f"v1={signature}",
        })
    except Exception:
        logger.warning("OCR callback delivery failed for event %s", event_id)
    with transaction.atomic():
        current = OCRWebhookEvent.objects.select_for_update().get(pk=event_id)
        if current.status != OCRWebhookEvent.Status.SENDING or current.lease_token != token:
            return
        if status_code and 200 <= status_code < 300:
            current.status = OCRWebhookEvent.Status.DELIVERED
        elif current.attempts >= settings.OCR_WEBHOOK_MAX_ATTEMPTS or (
            status_code and 300 <= status_code < 500 and status_code not in [408, 429]
        ):
            current.status = OCRWebhookEvent.Status.FAILED
        else:
            current.status = OCRWebhookEvent.Status.PENDING
            current.next_attempt_at = timezone.now() + timedelta(seconds=min(3600, 30 * 2 ** (current.attempts - 1)) * random.uniform(0.8, 1.2))
        current.last_status_code = status_code
        current.lease_token = None
        current.lease_expires_at = None
        current.save()


@shared_task(base=Task, queue="maintenance", autoretry_for=(), soft_time_limit=110, time_limit=120)
def recover_jobs():
    now = timezone.now()
    OCRUploadReservation.objects.filter(expires_at__lte=now).delete()
    expired = OCRJob.objects.filter(status=OCRJob.Status.PROCESSING, lease_expires_at__lte=now).values_list("id", flat=True)[:100]
    for job_id in list(expired):
        with transaction.atomic():
            job = OCRJob.objects.select_for_update().get(pk=job_id)
            if job.status == OCRJob.Status.PROCESSING and job.lease_expires_at <= now:
                finish_job(job, OCRJob.Status.FAILED, error_code="model_outcome_unknown")
    OCRWebhookEvent.objects.filter(status=OCRWebhookEvent.Status.SENDING, lease_expires_at__lte=now).update(
        status=OCRWebhookEvent.Status.PENDING, next_attempt_at=now, lease_token=None, lease_expires_at=None,
    )
    events = OCRWebhookEvent.objects.filter(status=OCRWebhookEvent.Status.PENDING, next_attempt_at__lte=timezone.now()).values_list("id", flat=True)[:100]
    for event_id in list(events):
        try:
            deliver_event.apply_async(args=[str(event_id)], queue="ocr-webhooks")
        except Exception:
            logger.warning("OCR callback dispatch deferred for event %s", event_id)
    terminal = OCRJob.objects.exclude(status__in=[OCRJob.Status.QUEUED, OCRJob.Status.PROCESSING])
    for job_id in list(terminal.exclude(storage_name="").values_list("id", flat=True)[:100]):
        cleanup_source(job_id)
    terminal.filter(result_expires_at__lte=now).exclude(status=OCRJob.Status.EXPIRED).update(status=OCRJob.Status.EXPIRED, result=None)
    cleanup_orphan_uploads()
    dispatch_jobs()


def cleanup_orphan_uploads():
    """Reap files from a killed request after its longest possible lease ended."""
    cutoff = (timezone.now() - timedelta(seconds=2 * settings.OCR_JOB_LEASE_SECONDS)).timestamp()
    root = settings.OCR_PRIVATE_ROOT
    if not os.path.isdir(root) or os.path.islink(root):
        return
    with os.scandir(root) as entries:
        for index, entry in enumerate(entries):
            if index >= 10000:
                break
            if not re.fullmatch(r"[0-9a-f]{32}", entry.name) or not entry.is_file(follow_symlinks=False):
                continue
            try:
                if entry.stat(follow_symlinks=False).st_mtime < cutoff and not OCRJob.objects.filter(storage_name=entry.name).exists():
                    delete_upload(entry.name)
            except OSError:
                logger.warning("OCR orphan cleanup deferred")
