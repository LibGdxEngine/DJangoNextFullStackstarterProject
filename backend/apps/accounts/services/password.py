from rest_framework.exceptions import Throttled
from apps.common.rate_limits import enforce_limits, ensure_available
import logging
from typing import Any, Dict, Optional
from django.core import signing
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from apps.accounts.models import User, UserStatus, VerificationChannel, VerificationPurpose
from apps.accounts.selectors import get_user_by_identifier
from apps.accounts.services.verification import create_verification_challenge, verify_challenge_code
from apps.messaging.tasks import send_verification_message

logger = logging.getLogger(__name__)

PASSWORD_RESET_SALT = "mobser.accounts.password_reset"
PASSWORD_RESET_TOKEN_MAX_AGE = 600  # 10 minutes


def initiate_password_reset(identifier: str) -> Dict[str, Any]:
    """
    Begins password recovery flow. Sends WhatsApp OTP to the user's verified phone.
    Uses a generic message; the existing optional challenge_id still reveals eligibility.
    """
    ensure_available()
    user = get_user_by_identifier(identifier)
    challenge_id: Optional[str] = None

    if user and user.phone_verified_at and user.status != UserStatus.BLOCKED:
        try:
            challenge, plain_code = create_verification_challenge(
                user=user,
                purpose=VerificationPurpose.PASSWORD_RESET,
                destination=user.phone,
                channel=VerificationChannel.WHATSAPP,
                expires_minutes=5,
            )
        except Throttled:
            # Recipient-only denials must not add a distinct recovery response.
            return {"message": "If an account exists, verification instructions were sent."}
        challenge_id = str(challenge.id)

        transaction.on_commit(
            lambda: send_verification_message.delay(challenge_id, plain_code)
        )
        logger.info("Password reset challenge %s created for user %s", challenge_id, user.id)

    response = {
        "message": "If an account exists, verification instructions were sent.",
    }
    if challenge_id:
        response["challenge_id"] = challenge_id

    return response


def verify_password_reset_code(challenge_id: str, code: str) -> str:
    """
    Validates the WhatsApp OTP challenge for password reset.
    Returns a short-lived, cryptographically signed reset_token.
    """
    challenge = verify_challenge_code(
        challenge_id=challenge_id,
        code=code,
        expected_purpose=VerificationPurpose.PASSWORD_RESET,
    )
    user = challenge.user

    payload = {
        "user_id": str(user.id),
        "token_version": user.token_version,
        "challenge_id": str(challenge.id),
        "timestamp": timezone.now().isoformat(),
    }
    signer = signing.TimestampSigner(salt=PASSWORD_RESET_SALT)
    return signer.sign_object(payload)


@transaction.atomic
def reset_password_with_token(reset_token: str, new_password: str) -> User:
    """
    Validates reset_token and updates user's password.
    Increments token_version to invalidate all existing sessions.
    """
    if not new_password or len(new_password) < 8:
        raise ValidationError("Password must be at least 8 characters long.")

    signer = signing.TimestampSigner(salt=PASSWORD_RESET_SALT)
    try:
        payload = signer.unsign_object(reset_token, max_age=PASSWORD_RESET_TOKEN_MAX_AGE)
    except (signing.BadSignature, signing.SignatureExpired) as exc:
        raise ValidationError("Password reset token is invalid or has expired.") from exc

    user_id = payload.get("user_id")
    token_version = payload.get("token_version")

    enforce_limits([("reset_subject", str(user_id))])
    user = User.objects.select_for_update().filter(id=user_id).first()
    if not user:
        raise ValidationError("User associated with this token does not exist.")

    if user.token_version != token_version:
        raise ValidationError("This password reset token is no longer valid.")

    user.set_password(new_password)
    user.token_version += 1
    user.save(update_fields=["password", "token_version", "updated_at"])
    logger.info("Password successfully reset for user %s", user.id)
    return user


@transaction.atomic
def change_password(user: User, old_password: str, new_password: str) -> None:
    """
    Changes password for an authenticated user and increments token_version.
    """
    request_version = user.token_version
    user = User.objects.select_for_update().get(pk=user.pk)
    if user.token_version != request_version:
        raise ValidationError("This session has been invalidated. Sign in again.")
    if not user.check_password(old_password):
        raise ValidationError("Current password is incorrect.")

    if not new_password or len(new_password) < 8:
        raise ValidationError("New password must be at least 8 characters long.")

    user.set_password(new_password)
    user.token_version += 1
    user.save(update_fields=["password", "token_version", "updated_at"])
    logger.info("Password changed by authenticated user %s", user.id)
