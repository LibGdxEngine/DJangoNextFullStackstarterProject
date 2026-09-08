import logging
from celery import shared_task
from apps.messaging.services import send_whatsapp_verification

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
)
def send_verification_message(self, challenge_id: str, code: str):
    """
    Celery background task to send an OTP verification message.
    Ensures HTTP endpoints return immediately without blocking on external WhatsApp APIs.
    """
    from apps.accounts.models import VerificationChallenge

    logger.info("Executing send_verification_message for challenge %s", challenge_id)

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

    send_whatsapp_verification(
        to=challenge.destination,
        code=code,
        purpose=challenge.purpose,
        connection_name="auth",
    )
    return True
