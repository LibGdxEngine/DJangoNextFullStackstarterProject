from django.conf import settings
from django.db import models

from apps.common.models import BaseModel


class OCRAPIKey(BaseModel):
    organization = models.ForeignKey("organizations.Organization", on_delete=models.CASCADE)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    name = models.CharField(max_length=100)
    secret_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)


class OCRUploadReservation(BaseModel):
    organization = models.ForeignKey("organizations.Organization", on_delete=models.CASCADE)
    expires_at = models.DateTimeField(db_index=True)


class OCRJob(BaseModel):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"

    organization = models.ForeignKey("organizations.Organization", on_delete=models.CASCADE)
    api_key = models.ForeignKey(OCRAPIKey, on_delete=models.RESTRICT)
    idempotency_key = models.CharField(max_length=128)
    fingerprint = models.CharField(max_length=64)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    storage_name = models.CharField(max_length=255, blank=True)
    sha256 = models.CharField(max_length=64)
    size = models.PositiveBigIntegerField()
    content_type = models.CharField(max_length=32)
    webhook_url = models.URLField(max_length=2048)
    error_code = models.CharField(max_length=64, blank=True)
    result = models.JSONField(null=True, blank=True)
    lease_token = models.UUIDField(null=True, blank=True)
    lease_expires_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    result_expires_at = models.DateTimeField(null=True, blank=True)
    dispatch_after = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "idempotency_key"], name="ocr_job_org_idempotency_unique")]
        indexes = [models.Index(fields=["status", "dispatch_after"])]


class OCRWebhookEvent(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENDING = "sending", "Sending"
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"

    job = models.OneToOneField(OCRJob, on_delete=models.CASCADE, related_name="webhook_event")
    payload = models.JSONField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(db_index=True)
    lease_token = models.UUIDField(null=True, blank=True)
    lease_expires_at = models.DateTimeField(null=True, blank=True)
    last_status_code = models.PositiveIntegerField(null=True, blank=True)


class OCRCapacity(models.Model):
    """A single database lock serializes aggregate admission across organizations."""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
