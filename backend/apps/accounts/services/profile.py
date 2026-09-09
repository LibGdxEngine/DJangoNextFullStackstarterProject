import logging
from typing import Any, Dict, Optional
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from apps.accounts.models import User, VerificationChannel, VerificationPurpose
from apps.accounts.phone import normalize_phone, mask_phone
from apps.accounts.selectors import is_email_available, is_phone_available
from apps.accounts.services.verification import create_verification_challenge, verify_challenge_code
from apps.messaging.tasks import send_verification_message

logger = logging.getLogger(__name__)


def update_profile(
    user: User,
    *,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    bio: Optional[str] = None,
    avatar_url: Optional[str] = None,
) -> User:
    update_fields = []
    if first_name is not None:
        user.first_name = first_name
        update_fields.append("first_name")
    if last_name is not None:
        user.last_name = last_name
        update_fields.append("last_name")
    if bio is not None:
        user.bio = bio
        update_fields.append("bio")
    if avatar_url is not None:
        user.avatar_url = avatar_url
        update_fields.append("avatar_url")

    if update_fields:
        update_fields.append("updated_at")
        user.save(update_fields=update_fields)

    return user


def initiate_phone_change(user: User, new_phone: str) -> Dict[str, Any]:
    """
    Phase 1 of phone change:
    Validates candidate phone number, creates challenge to NEW phone, and dispatches OTP.
    Does NOT update user.phone yet.
    """
    canonical_new_phone = normalize_phone(new_phone)

    if canonical_new_phone == user.phone:
        raise ValidationError("New phone number must be different from current phone number.")

    if not is_phone_available(canonical_new_phone, exclude_user_id=user.id):
        raise ValidationError("This phone number is already associated with another account.")

    challenge, plain_code = create_verification_challenge(
        user=user,
        purpose=VerificationPurpose.CHANGE_PHONE,
        destination=canonical_new_phone,
        channel=VerificationChannel.WHATSAPP,
        metadata={"new_phone": canonical_new_phone},
        expires_minutes=5,
    )

    transaction.on_commit(
        lambda: send_verification_message.delay(str(challenge.id), plain_code)
    )

    return {
        "verification_required": True,
        "challenge_id": str(challenge.id),
        "destination": mask_phone(canonical_new_phone),
        "expires_in": 300,
    }


def confirm_phone_change(user: User, challenge_id: str, code: str) -> User:
    """
    Phase 2 of phone change:
    Verifies code against candidate phone, checks uniqueness again, and updates User.phone.
    Bumps token_version to invalidate prior sessions.
    """
    challenge = verify_challenge_code(
        challenge_id=challenge_id,
        code=code,
        expected_purpose=VerificationPurpose.CHANGE_PHONE,
    )

    if challenge.user_id != user.id:
        raise ValidationError("Challenge does not belong to the authenticated user.")

    new_phone = challenge.metadata.get("new_phone")
    if not new_phone:
        raise ValidationError("Missing candidate phone number in challenge metadata.")

    # Prevent race condition before applying update
    if not is_phone_available(new_phone, exclude_user_id=user.id):
        raise ValidationError("This phone number has already been claimed by another account.")

    user.phone = new_phone
    user.phone_verified_at = timezone.now()
    user.token_version += 1
    user.save(update_fields=["phone", "phone_verified_at", "token_version", "updated_at"])

    logger.info("Phone number successfully updated for user %s", user.id)
    return user


def change_email(user: User, new_email: str, password: str) -> User:
    """
    Updates user email after verifying password.
    Resets email_verified_at to None since email ownership is not yet independently verified.
    Bumps token_version.
    """
    if not user.check_password(password):
        raise ValidationError("Current password is required to change email.")

    clean_email = new_email.strip().lower()
    if clean_email == user.email.lower():
        raise ValidationError("New email must be different from current email.")

    if not is_email_available(clean_email, exclude_user_id=user.id):
        raise ValidationError("This email address is already in use.")

    user.email = clean_email
    user.email_verified_at = None
    user.token_version += 1
    user.save(update_fields=["email", "email_verified_at", "token_version", "updated_at"])

    logger.info("Email updated for user %s", user.id)
    return user
