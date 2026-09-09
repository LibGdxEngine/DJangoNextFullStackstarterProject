import hashlib
import logging

from celery import shared_task

from apps.common.tasks import idempotent
from apps.messaging.services import send_whatsapp_verification

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    name="apps.messaging.tasks.send_verification_message",
    sensitive_args=("code",),
)
def send_verification_message(self, challenge_id: str, code: str):
    """
    Deliver an OTP verification message.

    Keyed on the challenge plus a digest of the code, so a redelivered message never sends a
    second OTP while a legitimate resend (which mints a new code) still goes out.
    """
    from apps.accounts.models import VerificationChallenge

    try:
        challenge = VerificationChallenge.objects.select_related("user").get(id=challenge_id)
    except VerificationChallenge.DoesNotExist:
        logger.error("VerificationChallenge %s does not exist. Aborting task.", challenge_id)
        return False

    if challenge.is_expired() or challenge.is_consumed():
        logger.warning(
            "Challenge %s is already consumed or expired. Skipping message dispatch.",
            challenge_id,
        )
        return False

    code_digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
    key = self.idempotency_key(challenge_id, code_digest)

    with idempotent(key, task_name=self.name, task_id=self.request.id) as guard:
        if guard.is_duplicate:
            return guard.result

        send_whatsapp_verification(
            to=challenge.destination,
            code=code,
            purpose=challenge.purpose,
            connection_name="auth",
            idempotency_key=key,
        )
        guard.record(True)
        return True
