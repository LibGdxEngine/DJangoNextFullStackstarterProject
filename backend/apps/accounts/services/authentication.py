from typing import Any, Dict, Optional
from uuid import UUID

from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.exceptions import ExpiredTokenError, InvalidToken, TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import AccessToken, Token

from apps.accounts.models import AuthSession, User, UserStatus


class PhoneVerificationRequiredError(Exception):
    def __init__(self, user: User):
        self.user = user
        self.message = "Phone verification is required before logging in."
        super().__init__(self.message)


class SessionRefreshToken(Token):
    # Family state replaces SimpleJWT's individual-token blacklist so a consumed,
    # correctly signed refresh token can still identify and revoke its family.
    token_type = "refresh"
    lifetime = api_settings.REFRESH_TOKEN_LIFETIME


def assert_account_eligible(user: User, *, allow_phone_onboarding=False) -> None:
    if not user.is_active:
        raise ValidationError("This account is inactive.")
    if user.status == UserStatus.BLOCKED:
        raise ValidationError("This account is blocked. Please contact support.")
    if user.status == UserStatus.DELETION_PENDING:
        raise ValidationError("This account is currently scheduled for deletion.")
    if user.status != UserStatus.ACTIVE or not user.phone_verified_at:
        if not allow_phone_onboarding:
            raise PhoneVerificationRequiredError(user)


def _issue_pair(user: User, session: AuthSession) -> Dict[str, str]:
    refresh = SessionRefreshToken.for_user(user)
    access = AccessToken.for_user(user)
    claims = {
        "sid": str(session.id),
        "token_version": session.token_version,
        "scope": session.scope,
    }
    for token in (refresh, access):
        for name, value in claims.items():
            token[name] = value
        token["exp"] = min(token["exp"], int(session.expires_at.timestamp()))
    refresh["generation"] = session.generation
    session.refresh_jti = refresh["jti"]
    session.save(update_fields=["refresh_jti", "generation"])
    return {"access": str(access), "refresh": str(refresh)}


def issue_tokens_for_user(user: User, *, allow_phone_onboarding=False) -> Dict[str, Any]:
    request_version = user.token_version
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        if user.token_version != request_version:
            raise ValidationError("Credentials changed during sign-in. Please sign in again.")
        assert_account_eligible(user, allow_phone_onboarding=allow_phone_onboarding)
        session = AuthSession.objects.create(
            user=user,
            token_version=user.token_version,
            scope="full" if user.status == UserStatus.ACTIVE and user.phone_verified_at else "phone_onboarding",
            expires_at=timezone.now() + api_settings.REFRESH_TOKEN_LIFETIME,
        )
        tokens = _issue_pair(user, session)
    return {
        **tokens,
        "user": {
            "id": str(user.id), "email": user.email, "phone": user.phone,
            "status": user.status, "first_name": user.first_name, "last_name": user.last_name,
        },
    }


def authenticate_user(identifier: str, password: str, request: Optional[Any] = None) -> User:
    user = authenticate(request=request, identifier=identifier, password=password)
    if not user:
        raise ValidationError("Invalid credentials.")
    assert_account_eligible(user)
    return user


def _session_id(token):
    try:
        return UUID(token["sid"])
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise InvalidToken("Token has no valid session.") from exc


def validate_session(token, user, session):
    if (
        session.user_id != user.pk
        or session.revoked_at is not None
        or session.expires_at <= timezone.now()
        or type(token.get("token_version")) is not int
        or token["token_version"] != user.token_version
        or session.token_version != user.token_version
        or token.get("scope") != session.scope
    ):
        raise InvalidToken("Session has expired or been revoked.")
    try:
        assert_account_eligible(user, allow_phone_onboarding=session.scope == "phone_onboarding")
    except (ValidationError, PhoneVerificationRequiredError) as exc:
        raise InvalidToken("Account is not eligible for this session.") from exc


def rotate_refresh_token(raw_token: str) -> Dict[str, str]:
    try:
        token = SessionRefreshToken(raw_token)
    except TokenError as exc:
        raise InvalidToken("Invalid refresh token.") from exc
    session_id = _session_id(token)
    reuse = False
    with transaction.atomic():
        try:
            session = AuthSession.objects.select_for_update().get(pk=session_id)
            user = User.objects.select_for_update().get(pk=session.user_id)
        except (AuthSession.DoesNotExist, User.DoesNotExist) as exc:
            raise InvalidToken("Session does not exist.") from exc
        if token.get(api_settings.USER_ID_CLAIM) != str(user.pk):
            raise InvalidToken("Invalid session owner.")
        validate_session(token, user, session)
        if token.get("generation") != session.generation or token.get("jti") != session.refresh_jti:
            session.revoked_at = timezone.now()
            session.save(update_fields=["revoked_at"])
            reuse = True
        else:
            session.generation += 1
            tokens = _issue_pair(user, session)
    # Raise only after the transaction commits: rolling this update back would
    # leave a stolen descendant credential valid after detecting replay.
    if reuse:
        raise InvalidToken("Refresh token reuse detected. Session revoked.")
    return tokens


def revoke_refresh_token(raw_token: str) -> None:
    try:
        token = SessionRefreshToken(raw_token)
        session_id = _session_id(token)
    except ExpiredTokenError:
        # Signature was verified; an expired family already rejects all access.
        return
    except (TokenError, InvalidToken) as exc:
        raise ValidationError("Invalid refresh token.") from exc
    # A previously consumed, authentic refresh credential may revoke its family.
    # No access token is required, and repeat logout is harmless.
    AuthSession.objects.filter(
        pk=session_id,
        user_id=token.get(api_settings.USER_ID_CLAIM),
        token_version=token.get("token_version"),
        revoked_at__isnull=True,
    ).update(revoked_at=timezone.now())
