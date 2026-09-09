import hashlib
import hmac
import json
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.organizations.models import Organization, OrganizationMember
from .authentication import eligible_user
from .exceptions import OCRCapacityExceeded, OCRConflict, OCRUnavailable
from .models import OCRAPIKey, OCRCapacity, OCRJob, OCRUploadReservation, OCRWebhookEvent


ACTIVE_STATUSES = [OCRJob.Status.QUEUED, OCRJob.Status.PROCESSING]


def require_enabled():
    if not settings.OCR_ENABLED or not settings.OCR_WEBHOOK_SIGNING_KEY:
        raise OCRUnavailable()


def signing_secret(key_id):
    return hmac.new(
        settings.OCR_WEBHOOK_SIGNING_KEY.encode(), f"ocr-webhook-v1:{key_id}".encode(), hashlib.sha256,
    ).hexdigest()


def create_api_key(organization, user, name):
    secret = secrets.token_urlsafe(32)
    key = OCRAPIKey.objects.create(
        organization=organization, created_by=user, name=name,
        secret_hash=hashlib.sha256(secret.encode()).hexdigest(),
        expires_at=timezone.now() + timedelta(days=settings.OCR_API_KEY_TTL_DAYS),
    )
    return key, f"ocr_{key.id.hex}.{secret}", signing_secret(key.id)


def _lock_capacity(organization_id):
    OCRCapacity.objects.get_or_create(pk=1)
    OCRCapacity.objects.select_for_update().get(pk=1)
    return Organization.objects.select_for_update().get(pk=organization_id)


def _bytes(queryset):
    return queryset.aggregate(total=Sum("size"))["total"] or 0


@transaction.atomic
def reserve_upload(organization_id):
    _lock_capacity(organization_id)
    now = timezone.now()
    reservations = OCRUploadReservation.objects.filter(expires_at__gt=now)
    jobs = OCRJob.objects.all()
    org_reservations = reservations.filter(organization_id=organization_id).count()
    org_jobs = jobs.filter(organization_id=organization_id)
    maximum = settings.OCR_MAX_UPLOAD_BYTES
    if (
        org_reservations + org_jobs.filter(status__in=ACTIVE_STATUSES).count() >= settings.OCR_MAX_PENDING_PER_ORG
        or reservations.count() + jobs.filter(status__in=ACTIVE_STATUSES).count() >= getattr(settings, "OCR_MAX_GLOBAL_PENDING", 50)
        or (org_reservations + 1) * maximum + _bytes(org_jobs.filter(created_at__gte=now - timedelta(days=1))) > settings.OCR_MAX_DAILY_BYTES
        or (org_reservations + 1) * maximum + _bytes(org_jobs.exclude(storage_name="")) > getattr(settings, "OCR_MAX_STORED_BYTES", 1500000000)
        or (reservations.count() + 1) * maximum + _bytes(jobs.exclude(storage_name="")) > getattr(settings, "OCR_MAX_GLOBAL_STORED_BYTES", 7500000000)
    ):
        raise OCRCapacityExceeded()
    return OCRUploadReservation.objects.create(
        organization_id=organization_id,
        expires_at=now + timedelta(seconds=settings.OCR_JOB_LEASE_SECONDS),
    )


@transaction.atomic
def accept_upload(key, reservation, idempotency_key, metadata, webhook_url):
    org = _lock_capacity(key.organization_id)
    current_key = OCRAPIKey.objects.select_related("created_by").filter(
        pk=key.pk, revoked_at__isnull=True, expires_at__gt=timezone.now(),
    ).first()
    if (not org.is_active or not current_key or not eligible_user(current_key.created_by)
            or not OrganizationMember.objects.filter(organization=org, user_id=current_key.created_by_id,
                role__in=[OrganizationMember.Role.ADMIN, OrganizationMember.Role.OWNER]).exists()):
        from rest_framework.exceptions import AuthenticationFailed
        raise AuthenticationFailed("Invalid OCR API key.")
    if not OCRUploadReservation.objects.filter(pk=reservation.pk, expires_at__gt=timezone.now()).exists():
        raise OCRCapacityExceeded("The upload reservation expired; submit the request again.")
    fingerprint = hashlib.sha256(json.dumps({
        "sha256": metadata["sha256"], "size": metadata["size"],
        "content_type": metadata["content_type"], "webhook_url": webhook_url,
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    existing = OCRJob.objects.filter(organization_id=key.organization_id, idempotency_key=idempotency_key).first()
    if existing:
        if existing.fingerprint != fingerprint:
            raise OCRConflict()
        return existing, False
    job = OCRJob.objects.create(
        organization_id=key.organization_id, api_key=key, idempotency_key=idempotency_key,
        fingerprint=fingerprint, webhook_url=webhook_url, **metadata,
    )
    reservation.delete()
    return job, True


def finish_job(job, status, *, result=None, error_code=""):
    """Caller holds the job row lock; state and callback event commit together."""
    now = timezone.now()
    job.status = status
    job.result = result
    job.error_code = error_code
    job.finished_at = now
    job.result_expires_at = now + timedelta(hours=settings.OCR_RESULT_RETENTION_HOURS)
    job.lease_token = None
    job.lease_expires_at = None
    job.save()
    event = OCRWebhookEvent(job=job, next_attempt_at=now)
    event.payload = {
        "id": str(event.id), "type": f"ocr.job.{status}", "created_at": now.isoformat(),
        "data": {"job_id": str(job.id), "status": status, "error_code": error_code,
                 "result_url": f"/api/v1/ocr/jobs/{job.id}/result/"},
    }
    event.save()
