import logging

from .models import WebhookEvent

logger = logging.getLogger(__name__)


def handle_message_sent(event: WebhookEvent) -> None:
    logger.info("HireAgents message.sent event processed")

def handle_message_received(event: WebhookEvent) -> None:
    logger.info("HireAgents message.received event processed")

def handle_contact_created(event: WebhookEvent) -> None:
    logger.info("HireAgents contact.created event processed")

def handle_contact_updated(event: WebhookEvent) -> None:
    logger.info("HireAgents contact.updated event processed")

def handle_opportunity_stage_changed(event: WebhookEvent) -> None:
    logger.info("HireAgents opportunity.stage_changed event processed")

HANDLERS = {
    "message.sent": handle_message_sent,
    "message.received": handle_message_received,
    "contact.created": handle_contact_created,
    "contact.updated": handle_contact_updated,
    "opportunity.stage_changed": handle_opportunity_stage_changed,
}
