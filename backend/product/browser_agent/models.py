from django.conf import settings
from django.db import models

from apps.common.models import BaseModel
from apps.organizations.models import Organization


class BrowserProfile(BaseModel):
    """A persistent Chromium profile (cookies, logins) that one run at a time may use."""
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='browser_profiles')
    name = models.CharField(max_length=100)
    in_use = models.BooleanField(default=False)

    class Meta:
        ordering = ['name']
        unique_together = ('organization', 'name')

    def __str__(self):
        return f'{self.organization} / {self.name}'

    @property
    def directory(self):
        return settings.AGENT_PROFILES_ROOT / str(self.organization_id) / str(self.id)


class AgentRun(BaseModel):
    class Status(models.TextChoices):
        QUEUED = 'queued', 'Queued'
        RUNNING = 'running', 'Running'
        SUCCEEDED = 'succeeded', 'Succeeded'
        FAILED = 'failed', 'Failed'
        CANCELLED = 'cancelled', 'Cancelled'
        TIMEOUT = 'timeout', 'Timed out'

    ACTIVE = (Status.QUEUED, Status.RUNNING)

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='agent_runs')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='agent_runs')
    profile = models.ForeignKey(
        BrowserProfile, null=True, blank=True, on_delete=models.SET_NULL, related_name='runs')
    task = models.TextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED, db_index=True)
    final_text = models.TextField(blank=True, default='')
    error = models.TextField(blank=True, default='')
    usage = models.JSONField(default=dict, blank=True)
    cancel_requested = models.BooleanField(default=False)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['organization', 'status'])]

    def __str__(self):
        return f'{self.id} [{self.status}]'


class AgentRunEvent(BaseModel):
    class Kind(models.TextChoices):
        MESSAGE = 'message', 'Agent message'
        TOOL_CALL = 'tool_call', 'Tool call'
        TOOL_RESULT = 'tool_result', 'Tool result'

    run = models.ForeignKey(AgentRun, on_delete=models.CASCADE, related_name='events')
    seq = models.PositiveIntegerField()
    kind = models.CharField(max_length=20, choices=Kind.choices)
    payload = models.JSONField(default=dict)

    class Meta:
        ordering = ['seq']
        unique_together = ('run', 'seq')


class AgentArtifact(BaseModel):
    class Kind(models.TextChoices):
        SCREENSHOT = 'screenshot', 'Screenshot'
        FILE = 'file', 'File'

    run = models.ForeignKey(AgentRun, on_delete=models.CASCADE, related_name='artifacts')
    kind = models.CharField(max_length=20, choices=Kind.choices)
    path = models.CharField(max_length=500, help_text='Relative to the run directory.')
    size = models.PositiveBigIntegerField(default=0)

    class Meta:
        ordering = ['created_at']
        unique_together = ('run', 'path')
