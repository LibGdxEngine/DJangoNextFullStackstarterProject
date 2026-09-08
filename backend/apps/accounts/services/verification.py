from datetime import timedelta
import hashlib
import hmac
import logging
import secrets
from typing import Any, Dict, Optional, Tuple
from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from apps.accounts.models import VerificationChallenge, VerificationChannel, VerificationPurpose

logger = logging.getLogger(__name__)


def generate_otp_code(length: int = 6) -> str:
    """
    Generate cryptographically secure numeric OTP of specified length.
    """
    range_start = 10 ** (length - 1)
    range_end = (10 ** length) - 1
    code_int = secrets.randbelow(range_end - range_start + 1) + range_start
    return str(code_int)


def compute_code_digest(code: str, secret: Optional[str] = None) -> str:
    """
    Computes a keyed HMAC-SHA256 digest of the OTP code using OTP_SECRET.
    Never store raw OTP codes in the database.
    """
    otp_secret = secret or getattr(settings, "OTP_SECRET", "fallback-secret-key-mobser")
    return hmac.new(
        otp_secret.encode("utf-8"),
        code.strip().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def create_verification_challenge(
    user,
    purpose: str,
    destination: str,
    channel: str = VerificationChannel.WHATSAPP,
    metadata: Optional[Dict[str, Any]] = None,
    expires_minutes: int = 5,
) -> Tuple[VerificationChallenge, str]:
    """
    Creates and persists a VerificationChallenge with hashed code_digest.
    Returns (challenge, plain_code) so the caller can transmit it via background worker.
    """
    plain_code = generate_otp_code()
    code_digest = compute_code_digest(plain_code)

    now = timezone.now()
    challenge = VerificationChallenge.objects.create(
        user=user,
        purpose=purpose,
        channel=channel,
        destination=destination,
        code_digest=code_digest,
        expires_at=now + timedelta(minutes=expires_minutes),
        attempt_count=0,
        max_attempts=5,
        resend_count=0,
        last_sent_at=now,
        metadata=metadata or {},
    )
    return challenge, plain_code


def verify_challenge_code(
    challenge_id: str,
    code: str,
    expected_purpose: Optional[str] = None,
) -> VerificationChallenge:
    """
    Validates OTP attempt against the stored challenge.
    Enforces expiration, single-use, max attempts, and constant-time digest comparison.
    """
    try:
        challenge = VerificationChallenge.objects.select_related("user").get(id=challenge_id)
    except (VerificationChallenge.DoesNotExist, ValueError):
        raise ValidationError("Verification challenge not found.")

    if expected_purpose and challenge.purpose != expected_purpose:
        raise ValidationError(f"Invalid verification challenge purpose. Expected '{expected_purpose}'.")

    if challenge.is_consumed():
        raise ValidationError("This verification code has already been used.")

    if challenge.is_expired():
        raise ValidationError("Verification code has expired. Please request a new one.")

    if challenge.attempt_count >= challenge.max_attempts:
        raise ValidationError("Maximum verification attempts exceeded. Please request a new code.")

    # Increment attempt count
    challenge.attempt_count += 1

    expected_digest = compute_code_digest(code)
    is_valid = secrets.compare_digest(expected_digest, challenge.code_digest)

    if not is_valid:
        challenge.save(update_fields=["attempt_count"])
        remaining = challenge.max_attempts - challenge.attempt_count
        raise ValidationError(f"Invalid verification code. {remaining} attempt(s) remaining.")

    # Success: mark challenge consumed
    challenge.consumed_at = timezone.now()
    challenge.save(update_fields=["attempt_count", "consumed_at"])
    return challenge


def resend_verification_challenge(
    challenge_id: str,
    cooldown_seconds: int = 60,
    max_resends: int = 5,
) -> Tuple[VerificationChallenge, str]:
    """
    Regenerates OTP for an existing challenge if within cooldown and resend limits.
    Returns (challenge, new_plain_code).
    """
    try:
        challenge = VerificationChallenge.objects.select_related("user").get(id=challenge_id)
    except (VerificationChallenge.DoesNotExist, ValueError):
        raise ValidationError("Verification challenge not found.")

    if challenge.is_consumed():
        raise ValidationError("Cannot resend code for an already verified challenge.")

    if challenge.resend_count >= max_resends:
        raise ValidationError(f"Maximum resend limit of {max_resends} reached.")

    now = timezone.now()
    if challenge.last_sent_at:
        elapsed = (now - challenge.last_sent_at).total_seconds()
        if elapsed < cooldown_seconds:
            wait_remaining = int(cooldown_seconds - elapsed)
            raise ValidationError(f"Please wait {wait_remaining} seconds before requesting a new code.")

    new_plain_code = generate_otp_code()
    challenge.code_digest = compute_code_digest(new_plain_code)
    challenge.expires_at = now + timedelta(minutes=5)
    challenge.resend_count += 1
    challenge.last_sent_at = now
    challenge.attempt_count = 0  # Reset attempt counter on fresh code
    challenge.save(update_fields=["code_digest", "expires_at", "resend_count", "last_sent_at", "attempt_count"])

    return challenge, new_plain_code
