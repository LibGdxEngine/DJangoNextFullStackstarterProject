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


class AgentRole(BaseModel):
    """A persona the agent works as. Without an organization it is built in and offered to everyone."""
    organization = models.ForeignKey(
        Organization, null=True, blank=True, on_delete=models.CASCADE, related_name='agent_roles')
    slug = models.SlugField(max_length=50)
    name = models.CharField(max_length=60)
    title = models.CharField(max_length=100, help_text='What the role does, shown under its name.')
    summary = models.CharField(max_length=300, blank=True, default='')
    skills = models.JSONField(default=list, blank=True)
    avatar = models.CharField(max_length=200, default='/agents/team.png')
    tint = models.CharField(max_length=20, default='#F2F0F8')
    instructions = models.TextField(blank=True, default='', help_text='Added to the agent system prompt.')
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'created_at']
        constraints = [
            models.UniqueConstraint(fields=['organization', 'slug'], name='agent_role_org_slug'),
            models.UniqueConstraint(fields=['slug'], condition=models.Q(organization__isnull=True),
                                    name='agent_role_builtin_slug'),
        ]

    def __str__(self):
        return f'{self.name} ({self.title})'

    @property
    def is_builtin(self):
        return self.organization_id is None


class TaskTemplate(BaseModel):
    """A ready-made request from the task library. Without an organization it is built in."""
    class Category(models.TextChoices):
        LEADS = 'leads', 'عملاء ومبيعات'
        MARKETING = 'mk', 'تسويق وحملات'
        SUPPORT = 'sup', 'خدمة العملاء'
        REPORTS = 'fin', 'تقارير وأنظمة'
        VIDEO = 'video', 'فيديو ومحتوى'
        PRESENTATIONS = 'pres', 'عروض تقديمية'
        RESEARCH = 'study', 'دراسة وبحث'

    organization = models.ForeignKey(
        Organization, null=True, blank=True, on_delete=models.CASCADE, related_name='task_templates')
    category = models.CharField(max_length=20, choices=Category.choices, db_index=True)
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=400, blank=True, default='')
    prompt = models.TextField(help_text='The request placed in the chat box.')
    image = models.CharField(max_length=200, default='/agents/team.png')
    role = models.ForeignKey(AgentRole, null=True, blank=True, on_delete=models.SET_NULL, related_name='templates')
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'created_at']

    def __str__(self):
        return self.title


class AgentRun(BaseModel):
    class Status(models.TextChoices):
        QUEUED = 'queued', 'Queued'
        RUNNING = 'running', 'Running'
        WAITING = 'waiting', 'Waiting for the user'
        SUCCEEDED = 'succeeded', 'Succeeded'
        FAILED = 'failed', 'Failed'
        CANCELLED = 'cancelled', 'Cancelled'
        TIMEOUT = 'timeout', 'Timed out'

    ACTIVE = (Status.QUEUED, Status.RUNNING, Status.WAITING)

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='agent_runs')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='agent_runs')
    profile = models.ForeignKey(
        BrowserProfile, null=True, blank=True, on_delete=models.SET_NULL, related_name='runs')
    role = models.ForeignKey(
        AgentRole, null=True, blank=True, on_delete=models.SET_NULL, related_name='runs')
    task = models.TextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED, db_index=True)
    final_text = models.TextField(blank=True, default='')
    error = models.TextField(blank=True, default='')
    usage = models.JSONField(default=dict, blank=True)
    cancel_requested = models.BooleanField(default=False)
    question = models.JSONField(
        null=True, blank=True, help_text='What the agent asked while waiting: kind, question, options.')
    answer = models.TextField(blank=True, default='', help_text="The user's answer, until the run resumes with it.")
    last_url = models.URLField(max_length=2000, blank=True, default='',
                               help_text='Page the browser was on, reopened when the run resumes.')
    heartbeat_at = models.DateTimeField(null=True, blank=True)
    recoveries = models.PositiveSmallIntegerField(
        default=0, help_text='Times the run was resumed after its worker stopped.')
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
        QUESTION = 'question', 'Question to the user'
        ANSWER = 'answer', "User's answer"

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
