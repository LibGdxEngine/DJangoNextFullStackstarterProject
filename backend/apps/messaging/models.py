import uuid
from django.db import models


class OutboundMessage(models.Model):
    """
    Log of outbound messages sent through messaging providers.
    Completely decoupled from authentication or specific provider implementations.
    """
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    provider = models.CharField(max_length=50, default="hireagents")
    connection = models.CharField(max_length=50, default="auth")
    channel = models.CharField(max_length=20, default="whatsapp")
    destination = models.CharField(max_length=255, db_index=True)
    template_name = models.CharField(max_length=100, blank=True, default="")
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.QUEUED,
    )
    provider_message_id = models.CharField(max_length=255, blank=True, null=True)
    error_message = models.TextField(blank=True, default="")
    # Set by the caller so a redelivered task reuses this row instead of sending twice.
    idempotency_key = models.CharField(max_length=64, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "messaging"
        ordering = ["-created_at"]
        verbose_name = "Outbound Message"
        verbose_name_plural = "Outbound Messages"
        constraints = [
            models.UniqueConstraint(
                fields=["idempotency_key"],
                condition=models.Q(idempotency_key__isnull=False),
                name="messaging_outboundmessage_idempotency_key_unique",
            ),
        ]

    def __str__(self):
        return f"[{self.status}] {self.destination} via {self.provider}:{self.connection}"
