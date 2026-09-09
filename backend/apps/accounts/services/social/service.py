from typing import Any, Dict, Tuple

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import SocialAccount, User, UserStatus
from apps.common.rate_limits import enforce_limits
from apps.accounts.selectors import get_social_account

from ..authentication import assert_account_eligible, issue_tokens_for_user
from .base import SocialAuthError, SocialIdentity
from .registry import get_verifier


def authenticate_with_social_provider(*, provider: str, token: str) -> Dict[str, Any]:
    """
    Verifies a provider token, resolves it to a local user, and issues the standard
    access/refresh pair so social sign-in returns the same envelope as password login.
    """
    identity = get_verifier(provider)(token)
    enforce_limits([("social_subject", f"{identity.provider}:{identity.provider_user_id}")])

    try:
        with transaction.atomic():
            user, created = _resolve_user(identity)
    except IntegrityError:
        # Concurrent first sign-in won the race; the account now exists.
        with transaction.atomic():
            user, created = _resolve_user(identity)

    try:
        tokens = issue_tokens_for_user(user, allow_phone_onboarding=True)
    except ValidationError as exc:
        raise SocialAuthError(exc.message) from exc
    tokens["created"] = created
    tokens["requires_phone"] = not user.phone_verified_at
    return tokens


def _resolve_user(identity: SocialIdentity) -> Tuple[User, bool]:
    social_account = get_social_account(identity.provider, identity.provider_user_id)

    if social_account:
        _assert_can_sign_in(social_account.user)
        social_account.email = identity.email
        social_account.last_login_at = timezone.now()
        social_account.save(update_fields=["email", "last_login_at"])
        return social_account.user, False

    user = User.objects.filter(email__iexact=identity.email).first()
    created = False

    if user:
        _assert_can_sign_in(user)
        _mark_email_verified(user)
    else:
        user = User.objects.create_social_user(
            email=identity.email,
            first_name=identity.first_name,
            last_name=identity.last_name,
            avatar_url=identity.avatar_url or None,
            status=UserStatus.ACTIVE,
            email_verified_at=timezone.now(),
        )
        created = True

    SocialAccount.objects.create(
        user=user,
        provider=identity.provider,
        provider_user_id=identity.provider_user_id,
        email=identity.email,
        last_login_at=timezone.now(),
    )
    return user, created


def _assert_can_sign_in(user: User) -> None:
    try:
        assert_account_eligible(user, allow_phone_onboarding=True)
    except ValidationError as exc:
        raise SocialAuthError(exc.message) from exc


def _mark_email_verified(user: User) -> None:
    """
    The provider vouches for the email, which also clears a signup that never finished.
    """
    updated_fields = []

    if not user.email_verified_at:
        user.email_verified_at = timezone.now()
        updated_fields.append("email_verified_at")

    if user.status == UserStatus.PENDING:
        user.status = UserStatus.ACTIVE
        updated_fields.append("status")

    if updated_fields:
        user.save(update_fields=[*updated_fields, "updated_at"])
