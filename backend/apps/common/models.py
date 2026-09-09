import uuid
from django.db import models

class UUIDModel(models.Model):
    """
    Abstract model that provides a UUID primary key.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    """
    Abstract model that provides self-updating created_at and updated_at fields.
    """
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BaseModel(UUIDModel, TimeStampedModel):
    """
    Convenience abstract base model combining UUID primary key and timestamp fields.
    """
    class Meta:
        abstract = True


class TaskExecution(BaseModel):
    """
    Idempotency ledger for background tasks: one row per logical unit of work, keyed by a
    fingerprint of the task name and its inputs.
    """
    class Status(models.TextChoices):
        RUNNING = 'running', 'Running'
        SUCCEEDED = 'succeeded', 'Succeeded'
        FAILED = 'failed', 'Failed'

    key = models.CharField(max_length=64, unique=True)
    task_name = models.CharField(max_length=255, db_index=True)
    task_id = models.CharField(max_length=255, blank=True, default='')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.RUNNING, db_index=True)
    result = models.JSONField(null=True, blank=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'expires_at']),
        ]

    def __str__(self):
        return f'{self.task_name} [{self.status}]'


class FailedTask(BaseModel):
    """
    Dead-letter store for tasks that exhausted their retries.

    Redis offers no dead-letter exchange, so exhausted work is captured here instead where
    it can be inspected and requeued from the admin. Arguments are redacted before they are
    written, so secrets such as OTP codes are never persisted.
    """
    class Status(models.TextChoices):
        NEW = 'new', 'New'
        REQUEUED = 'requeued', 'Requeued'
        IGNORED = 'ignored', 'Ignored'

    task_name = models.CharField(max_length=255, db_index=True)
    task_id = models.CharField(max_length=255, blank=True, default='', db_index=True)
    queue = models.CharField(max_length=100, blank=True, default='')
    args = models.JSONField(default=list, blank=True)
    kwargs = models.JSONField(default=dict, blank=True)
    exception_class = models.CharField(max_length=255, blank=True, default='')
    exception_message = models.TextField(blank=True, default='')
    traceback = models.TextField(blank=True, default='')
    retries = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW, db_index=True)
    requeued_task_id = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.task_name} failed with {self.exception_class}'

