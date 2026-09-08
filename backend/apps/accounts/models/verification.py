import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


class VerificationPurpose(models.TextChoices):
    SIGNUP = "signup", "Signup"
    PASSWORD_RESET = "password_reset", "Password Reset"
    CHANGE_PHONE = "change_phone", "Change Phone"
    CHANGE_EMAIL = "change_email", "Change Email"
    DELETE_ACCOUNT = "delete_account", "Delete Account"
    STEP_UP = "step_up", "Step Up"


class VerificationChannel(models.TextChoices):
    WHATSAPP = "whatsapp", "WhatsApp"
    EMAIL = "email", "Email"
    SMS = "sms", "SMS"


class VerificationChallenge(models.Model):
    """
    Reusable verification challenge model.
    Stores HMAC digest of OTP instead of plain OTP text.
    Tracks expiration, attempts, resend limits, and metadata.
    """
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="verification_challenges",
    )

    purpose = models.CharField(
        max_length=30,
        choices=VerificationPurpose.choices,
    )

    channel = models.CharField(
        max_length=20,
        choices=VerificationChannel.choices,
    )

    destination = models.CharField(max_length=255, db_index=True)

    code_digest = models.CharField(max_length=255)

    expires_at = models.DateTimeField()

    attempt_count = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=5)

    resend_count = models.PositiveIntegerField(default=0)
    last_sent_at = models.DateTimeField(null=True, blank=True)

    consumed_at = models.DateTimeField(null=True, blank=True)

    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Verification Challenge"
        verbose_name_plural = "Verification Challenges"

    def __str__(self):
        return f"Challenge [{self.purpose}:{self.channel}] -> {self.destination} ({self.id})"

    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at

    def is_consumed(self) -> bool:
        return self.consumed_at is not None

    def can_attempt(self) -> bool:
        return not self.is_consumed() and not self.is_expired() and (self.attempt_count < self.max_attempts)

    def can_resend(self, cooldown_seconds: int = 60, max_resends: int = 5) -> bool:
        if self.is_consumed():
            return False
        if self.resend_count >= max_resends:
            return False
        if self.last_sent_at:
            delta = (timezone.now() - self.last_sent_at).total_seconds()
            if delta < cooldown_seconds:
                return False
        return True
