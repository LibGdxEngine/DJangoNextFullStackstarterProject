import uuid
from django.db import models


class WebhookEvent(models.Model):
    """
    Stores incoming raw webhook events before asynchronous background processing.
    Allows reliable inspection, debugging, and replaying of events.
    """
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSED = "processed", "Processed"
        FAILED = "failed", "Failed"
        IGNORED = "ignored", "Ignored"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    provider = models.CharField(max_length=50, default="hireagents")
    connection = models.CharField(max_length=50)
    provider_event_id = models.CharField(max_length=255, null=True, blank=True)
    event_type = models.CharField(max_length=100, db_index=True)
    payload = models.JSONField(default=dict)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True, default="")

    class Meta:
        app_label = "integrations"
        ordering = ["-received_at"]
        verbose_name = "Webhook Event"
        verbose_name_plural = "Webhook Events"
        constraints = [
            # Providers retry deliveries, so the same event id must never be stored twice.
            models.UniqueConstraint(
                fields=["provider", "connection", "provider_event_id"],
                condition=models.Q(provider_event_id__isnull=False),
                name="integrations_webhookevent_provider_event_unique",
            ),
        ]

    def __str__(self):
        return f"[{self.status}] {self.provider}:{self.connection} - {self.event_type} ({self.id})"
