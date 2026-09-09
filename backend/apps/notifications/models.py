from django.db import models
from django.conf import settings
from apps.common.models import BaseModel

class Notification(BaseModel):
    class NotificationType(models.TextChoices):
        INFO = 'INFO', 'Information'
        SUCCESS = 'SUCCESS', 'Success'
        WARNING = 'WARNING', 'Warning'
        ALERT = 'ALERT', 'Alert'

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications'
    )
    title = models.CharField(max_length=255)
    message = models.TextField()
    notification_type = models.CharField(
        max_length=20,
        choices=NotificationType.choices,
        default=NotificationType.INFO
    )
    link = models.CharField(max_length=500, blank=True, null=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    # Lets a redelivered task reuse this row instead of creating a duplicate notification.
    dedupe_key = models.CharField(max_length=64, blank=True, null=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Notification'
        verbose_name_plural = 'Notifications'
        constraints = [
            models.UniqueConstraint(
                fields=['dedupe_key'],
                condition=models.Q(dedupe_key__isnull=False),
                name='notifications_notification_dedupe_key_unique',
            ),
        ]

    def __str__(self):
        return f"[{self.notification_type}] {self.title} -> {self.recipient}"
