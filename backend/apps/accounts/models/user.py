import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.functions import Lower
from apps.accounts.managers import CustomUserManager


class UserStatus(models.TextChoices):
    PENDING = "pending", "Pending verification"
    ACTIVE = "active", "Active"
    BLOCKED = "blocked", "Blocked"
    DELETION_PENDING = "deletion_pending", "Deletion pending"


class User(AbstractUser):
    """
    Custom user model without username. Identified by canonical email and E.164 phone.
    WhatsApp OTP verification proves ownership of phone before status becomes ACTIVE.
    """
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    username = None

    email = models.EmailField()

    # Nullable: social sign-in providers do not supply a phone number.
    phone = models.CharField(max_length=20, null=True, blank=True)

    phone_verified_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    email_verified_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    status = models.CharField(
        max_length=30,
        choices=UserStatus.choices,
        default=UserStatus.PENDING,
    )

    deletion_requested_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    token_version = models.PositiveIntegerField(default=1)

    avatar_url = models.URLField(max_length=500, blank=True, null=True)
    bio = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = CustomUserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["phone"]

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "User"
        verbose_name_plural = "Users"
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                name="accounts_user_email_ci_unique",
            ),
            models.UniqueConstraint(
                fields=["phone"],
                name="accounts_user_phone_unique",
            ),
        ]

    def __str__(self):
        return f"{self.email} ({self.phone})"

    @property
    def is_phone_verified(self) -> bool:
        return self.phone_verified_at is not None

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None
