import logging
from typing import Any, Dict
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from apps.accounts.models import User, UserStatus, VerificationChannel, VerificationPurpose
from apps.accounts.phone import mask_phone
from apps.accounts.services.verification import create_verification_challenge, verify_challenge_code
from apps.messaging.tasks import send_verification_message

logger = logging.getLogger(__name__)


def initiate_account_deletion(user: User, password: str) -> Dict[str, Any]:
    """
    Step-up action: requires password and sends WhatsApp OTP to confirmed phone.
    """
    if not user.check_password(password):
        raise ValidationError("Password confirmation failed.")

    challenge, plain_code = create_verification_challenge(
        user=user,
        purpose=VerificationPurpose.DELETE_ACCOUNT,
        destination=user.phone,
        channel=VerificationChannel.WHATSAPP,
        expires_minutes=5,
    )

    transaction.on_commit(
        lambda: send_verification_message.delay(str(challenge.id), plain_code)
    )

    return {
        "verification_required": True,
        "challenge_id": str(challenge.id),
        "destination": mask_phone(user.phone),
        "message": "Verification code sent to your phone to confirm account deletion.",
    }


def confirm_account_deletion(user: User, challenge_id: str, code: str) -> User:
    """
    Verifies deletion OTP challenge, marks account DELETION_PENDING,
    and bumps token_version to invalidate all existing sessions immediately.
    """
    challenge = verify_challenge_code(
        challenge_id=challenge_id,
        code=code,
        expected_purpose=VerificationPurpose.DELETE_ACCOUNT,
    )

    if challenge.user_id != user.id:
        raise ValidationError("Verification challenge does not match the authenticated user.")

    user.status = UserStatus.DELETION_PENDING
    user.deletion_requested_at = timezone.now()
    user.token_version += 1
    user.save(update_fields=["status", "deletion_requested_at", "token_version", "updated_at"])

    logger.warning("Account marked DELETION_PENDING for user %s", user.id)
    return user
