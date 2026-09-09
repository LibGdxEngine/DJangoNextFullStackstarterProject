import uuid
from django.conf import settings
from django.db import models


class SocialProvider(models.TextChoices):
    GOOGLE = "google", "Google"


class SocialAccount(models.Model):
    """
    Links a local user to an external identity provider account.
    Pinned to the provider's stable subject id, so the link survives email changes.
    """
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="social_accounts",
    )

    provider = models.CharField(
        max_length=30,
        choices=SocialProvider.choices,
    )

    provider_user_id = models.CharField(max_length=255)

    email = models.EmailField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Social Account"
        verbose_name_plural = "Social Accounts"
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "provider_user_id"],
                name="accounts_socialaccount_provider_uid_unique",
            ),
        ]

    def __str__(self):
        return f"{self.provider}:{self.provider_user_id} ({self.user_id})"
