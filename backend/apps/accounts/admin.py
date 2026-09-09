from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import SocialAccount, User, VerificationChallenge


@admin.register(User)
class CustomUserAdmin(BaseUserAdmin):
    list_display = (
        "email",
        "phone",
        "first_name",
        "last_name",
        "status",
        "phone_verified_at",
        "is_staff",
        "created_at",
    )
    list_filter = ("status", "is_staff", "is_superuser", "created_at")
    search_fields = ("email", "phone", "first_name", "last_name")
    ordering = ("-created_at",)

    fieldsets = (
        (None, {"fields": ("email", "phone", "password")}),
        (
            "Personal info",
            {"fields": ("first_name", "last_name", "avatar_url", "bio")},
        ),
        (
            "Verification & Status",
            {
                "fields": (
                    "status",
                    "phone_verified_at",
                    "email_verified_at",
                    "deletion_requested_at",
                    "token_version",
                )
            },
        ),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )

    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "phone", "password", "password2"),
            },
        ),
    )


@admin.register(VerificationChallenge)
class VerificationChallengeAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "purpose",
        "channel",
        "destination",
        "expires_at",
        "attempt_count",
        "consumed_at",
        "created_at",
    )
    list_filter = ("purpose", "channel", "created_at")
    search_fields = ("id", "destination", "user__email", "user__phone")
    readonly_fields = ("id", "code_digest", "created_at", "last_sent_at")


@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ("provider", "email", "user", "provider_user_id", "last_login_at", "created_at")
    list_filter = ("provider", "created_at")
    search_fields = ("email", "provider_user_id", "user__email")
    readonly_fields = ("provider", "provider_user_id", "created_at", "last_login_at")
