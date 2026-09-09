import logging
from typing import Any, Dict
from django.db import transaction
from django.core.exceptions import ValidationError
from apps.accounts.models import User, UserStatus, VerificationPurpose, VerificationChannel
from apps.accounts.phone import normalize_phone, mask_phone
from apps.accounts.selectors import is_email_available, is_phone_available
from apps.accounts.services.verification import _create_verification_challenge
from apps.common.rate_limits import reserve_send
from apps.messaging.tasks import send_verification_message

logger = logging.getLogger(__name__)


def signup_user(
    *,
    email: str,
    phone: str,
    password: str,
    first_name: str = "",
    last_name: str = "",
) -> Dict[str, Any]:
    """
    Registers a new user in PENDING status and issues a WhatsApp OTP challenge.
    Dispatches Celery background worker upon transaction commit.
    """
    if not email:
        raise ValidationError("Email is required.")
    if not phone:
        raise ValidationError("Phone number is required.")
    if not password:
        raise ValidationError("Password is required.")

    clean_email = email.strip().lower()
    canonical_phone = normalize_phone(phone)

    if not is_email_available(clean_email):
        raise ValidationError("An account with this email address already exists.")

    if not is_phone_available(canonical_phone):
        raise ValidationError("An account with this phone number already exists.")

    reserve_send(canonical_phone, VerificationChannel.WHATSAPP)
    with transaction.atomic():
        user = User.objects.create_user(
            email=clean_email,
            phone=canonical_phone,
            password=password,
            first_name=first_name,
            last_name=last_name,
            status=UserStatus.PENDING,
        )

        challenge, plain_code = _create_verification_challenge(
            user=user,
            purpose=VerificationPurpose.SIGNUP,
            destination=canonical_phone,
            channel=VerificationChannel.WHATSAPP,
            expires_minutes=5,
        )

        # Non-blocking async dispatch via Celery upon transaction commit
        transaction.on_commit(
            lambda: send_verification_message.delay(str(challenge.id), plain_code)
        )

    logger.info("Created user %s (status=pending). Challenge %s created.", user.id, challenge.id)

    return {
        "verification_required": True,
        "challenge_id": str(challenge.id),
        "destination": mask_phone(canonical_phone),
        "expires_in": 300,
    }
