from typing import Any, Dict, Optional
from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import User, UserStatus
from apps.accounts.phone import mask_phone


class PhoneVerificationRequiredError(Exception):
    """
    Raised when credentials are correct but user has not verified their phone number.
    """
    def __init__(self, user: User):
        self.user = user
        self.message = "Phone verification is required before logging in."
        super().__init__(self.message)


def issue_tokens_for_user(user: User) -> Dict[str, Any]:
    """
    Generates SimpleJWT access and refresh tokens embedding token_version.
    """
    refresh = RefreshToken.for_user(user)
    refresh["token_version"] = user.token_version
    refresh["email"] = user.email
    refresh["phone"] = user.phone
    refresh["status"] = user.status

    # Also include claims in access token
    access = refresh.access_token
    access["token_version"] = user.token_version
    access["email"] = user.email
    access["phone"] = user.phone
    access["status"] = user.status

    return {
        "access": str(access),
        "refresh": str(refresh),
        "user": {
            "id": str(user.id),
            "email": user.email,
            "phone": user.phone,
            "status": user.status,
            "first_name": user.first_name,
            "last_name": user.last_name,
        },
    }


def authenticate_user(
    identifier: str,
    password: str,
    request: Optional[Any] = None,
) -> User:
    """
    Authenticates by email or phone + password.
    Checks phone verification status and account block status.
    """
    user = authenticate(request=request, identifier=identifier, password=password)

    if not user:
        raise ValidationError("Invalid credentials.")

    if not user.phone_verified_at or user.status == UserStatus.PENDING:
        raise PhoneVerificationRequiredError(user=user)

    if user.status == UserStatus.BLOCKED:
        raise ValidationError("This account is blocked. Please contact support.")

    if user.status == UserStatus.DELETION_PENDING:
        raise ValidationError("This account is currently scheduled for deletion.")

    return user


def revoke_refresh_token(refresh_token_str: str) -> None:
    """
    Blacklists a refresh token.
    """
    try:
        token = RefreshToken(refresh_token_str)
        token.blacklist()
    except Exception as exc:
        raise ValidationError(f"Invalid or already blacklisted refresh token: {exc}")
