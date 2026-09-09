import uuid

from django.conf import settings
from django.db import models


class AuthSession(models.Model):
    """A revocable JWT family with one current refresh credential."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="auth_sessions")
    token_version = models.PositiveIntegerField()
    scope = models.CharField(max_length=32, default="full")
    refresh_jti = models.CharField(max_length=64)
    generation = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
