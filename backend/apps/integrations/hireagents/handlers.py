import logging

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
