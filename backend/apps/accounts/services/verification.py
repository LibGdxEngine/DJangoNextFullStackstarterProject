from dataclasses import dataclass
from datetime import timedelta
import hashlib
import hmac
import logging
import secrets
from typing import Any, Callable, Dict, Optional, Tuple
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from apps.common.rate_limits import reserve_send
from django.utils import timezone
from apps.accounts.models import User, UserStatus, VerificationChallenge, VerificationChannel, VerificationPurpose

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
    reserve_send(destination, channel)
    return _create_verification_challenge(
        user, purpose, destination, channel, metadata, expires_minutes,
    )


def _create_verification_challenge(
    user, purpose, destination, channel=VerificationChannel.WHATSAPP,
    metadata=None, expires_minutes=5,
):
    """Internal persistence step; caller must reserve the send before any writes."""
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


@dataclass(frozen=True)
class VerificationOutcome:
    challenge: Optional[VerificationChallenge] = None
    error: Optional[ValidationError] = None

    def unwrap(self) -> VerificationChallenge:
        # An outer owner must commit the failed attempt before raising its error.
        connection = transaction.get_connection()
        if any(not getattr(block, "_from_testcase", False) for block in connection.atomic_blocks):
            raise RuntimeError("Commit the verification transaction before unwrapping its outcome.")
        if self.error:
            raise self.error
        return self.challenge


def verify_challenge_outcome(
    challenge_id: str, code: str, expected_purpose: Optional[str] = None,
    expected_user_id=None, on_verified: Optional[Callable] = None,
) -> VerificationOutcome:
    """Return failure as data so an enclosing owner can commit before unwrap().

    Lock order is challenge then user. Successful business updates run under the
    same locks as consumption; any update error rolls both changes back.
    """
    with transaction.atomic():
        try:
            challenge = VerificationChallenge.objects.select_for_update().get(id=challenge_id)
        except (VerificationChallenge.DoesNotExist, ValueError, ValidationError):
            return VerificationOutcome(error=ValidationError("Verification challenge not found."))

        error = None
        if expected_purpose and challenge.purpose != expected_purpose:
            error = f"Invalid verification challenge purpose. Expected '{expected_purpose}'."
        elif expected_user_id is not None and str(challenge.user_id) != str(expected_user_id):
            error = "Challenge does not belong to the authenticated user."
        elif challenge.is_consumed():
            error = "This verification code has already been used."
        elif challenge.is_expired():
            error = "Verification code has expired. Please request a new one."
        elif challenge.attempt_count >= challenge.max_attempts:
            error = "Maximum verification attempts exceeded. Please request a new code."
        if error:
            return VerificationOutcome(error=ValidationError(error))

        challenge.attempt_count += 1
        if not secrets.compare_digest(compute_code_digest(code), challenge.code_digest):
            challenge.save(update_fields=["attempt_count"])
            remaining = challenge.max_attempts - challenge.attempt_count
            return VerificationOutcome(error=ValidationError(
                f"Invalid verification code. {remaining} attempt(s) remaining."
            ))

        challenge.user = User.objects.select_for_update().get(pk=challenge.user_id)
        if on_verified:
            on_verified(challenge)
        challenge.consumed_at = timezone.now()
        challenge.save(update_fields=["attempt_count", "consumed_at"])
        return VerificationOutcome(challenge=challenge)


def verify_challenge_code(
    challenge_id: str, code: str, expected_purpose: Optional[str] = None,
    expected_user_id=None, on_verified: Optional[Callable] = None,
) -> VerificationChallenge:
    """Own the commit boundary. Nested callers must use the outcome API instead."""
    with transaction.atomic(durable=True):
        outcome = verify_challenge_outcome(
            challenge_id, code, expected_purpose, expected_user_id, on_verified,
        )
    return outcome.unwrap()


def confirm_signup(challenge_id: str, code: str) -> VerificationChallenge:
    def activate(challenge):
        user = challenge.user
        if not user.is_active or user.status not in (UserStatus.PENDING, UserStatus.ACTIVE):
            raise ValidationError("This account cannot be activated.")
        user.phone_verified_at = timezone.now()
        user.status = UserStatus.ACTIVE
        user.save(update_fields=["phone_verified_at", "status", "updated_at"])

    return verify_challenge_code(
        challenge_id, code, VerificationPurpose.SIGNUP, on_verified=activate,
    )


@transaction.atomic
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
        challenge = VerificationChallenge.objects.select_for_update().get(id=challenge_id)
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

    reserve_send(challenge.destination, challenge.channel)
    new_plain_code = generate_otp_code()
    challenge.code_digest = compute_code_digest(new_plain_code)
    challenge.expires_at = now + timedelta(minutes=5)
    challenge.resend_count += 1
    challenge.last_sent_at = now
    challenge.attempt_count = 0  # Reset attempt counter on fresh code
    challenge.save(update_fields=["code_digest", "expires_at", "resend_count", "last_sent_at", "attempt_count"])

    return challenge, new_plain_code
