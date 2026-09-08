import logging
import traceback
from celery import shared_task
from django.utils import timezone
from .models import WebhookEvent

logger = logging.getLogger(__name__)


def handle_message_sent(event: WebhookEvent) -> None:
    payload = event.payload
    logger.info(
        "HireAgents message.sent event processed for connection=%s: message_id=%s, recipient=%s",
        event.connection,
        payload.get("id") or payload.get("message_id"),
        payload.get("to"),
    )


def handle_message_received(event: WebhookEvent) -> None:
    payload = event.payload
    logger.info(
        "HireAgents message.received event processed for connection=%s: sender=%s, content=%s",
        event.connection,
        payload.get("from"),
        payload.get("text") or payload.get("message"),
    )


def handle_contact_created(event: WebhookEvent) -> None:
    payload = event.payload
    logger.info(
        "HireAgents contact.created event for connection=%s: contact_id=%s",
        event.connection,
        payload.get("contact_id") or payload.get("id"),
    )


def handle_contact_updated(event: WebhookEvent) -> None:
    payload = event.payload
    logger.info(
        "HireAgents contact.updated event for connection=%s: contact_id=%s",
        event.connection,
        payload.get("contact_id") or payload.get("id"),
    )


def handle_opportunity_stage_changed(event: WebhookEvent) -> None:
    payload = event.payload
    logger.info(
        "HireAgents opportunity.stage_changed event for connection=%s: stage=%s",
        event.connection,
        payload.get("stage"),
    )


HANDLERS = {
    "message.sent": handle_message_sent,
    "message.received": handle_message_received,
    "contact.created": handle_contact_created,
    "contact.updated": handle_contact_updated,
    "opportunity.stage_changed": handle_opportunity_stage_changed,
}


@shared_task(bind=True, max_retries=2, default_retry_delay=10)
def process_hireagents_event(self, event_id: str):
    """
    Celery background worker task to process a persisted HireAgents WebhookEvent.
    """
    try:
        event = WebhookEvent.objects.get(id=event_id)
    except WebhookEvent.DoesNotExist:
        logger.error("WebhookEvent %s not found. Skipping.", event_id)
        return False

    try:
        handler = HANDLERS.get(event.event_type)
        if handler:
            handler(event)
            event.status = WebhookEvent.Status.PROCESSED
        else:
            logger.info("No specific handler registered for event type '%s'. Marked ignored.", event.event_type)
            event.status = WebhookEvent.Status.IGNORED

        event.processed_at = timezone.now()
        event.save(update_fields=["status", "processed_at"])
        return True
    except Exception as exc:
        logger.error("Error processing WebhookEvent %s: %s\n%s", event_id, exc, traceback.format_exc())
        event.status = WebhookEvent.Status.FAILED
        event.error = f"{exc}\n{traceback.format_exc()}"
        event.save(update_fields=["status", "error"])
        raise
