import logging
import traceback

from celery import shared_task
from django.utils import timezone

from apps.common.tasks import idempotent

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="apps.integrations.tasks.process_hireagents_event", max_retries=2)
def process_hireagents_event(self, event_id: str):
    """Process a persisted HireAgents webhook event exactly once."""
    from apps.integrations.hireagents.handlers import HANDLERS
    from apps.integrations.hireagents.models import WebhookEvent

    try:
        event = WebhookEvent.objects.get(id=event_id)
    except WebhookEvent.DoesNotExist:
        logger.error("WebhookEvent %s not found. Skipping.", event_id)
        return False

    if event.status in (WebhookEvent.Status.PROCESSED, WebhookEvent.Status.IGNORED):
        logger.info("WebhookEvent %s was already handled (%s). Skipping.", event_id, event.status)
        return False

    key = self.idempotency_key(event_id)
    with idempotent(key, task_name=self.name, task_id=self.request.id) as guard:
        if guard.is_duplicate:
            return guard.result

        try:
            handler = HANDLERS.get(event.event_type)
            if handler:
                handler(event)
                event.status = WebhookEvent.Status.PROCESSED
            else:
                logger.info(
                    "No specific handler registered for event type '%s'. Marked ignored.",
                    event.event_type,
                )
                event.status = WebhookEvent.Status.IGNORED

            event.processed_at = timezone.now()
            event.save(update_fields=["status", "processed_at"])
        except Exception as exc:
            logger.error(
                "Error processing WebhookEvent %s: %s\n%s", event_id, exc, traceback.format_exc()
            )
            event.status = WebhookEvent.Status.FAILED
            event.error = f"{exc}\n{traceback.format_exc()}"
            event.save(update_fields=["status", "error"])
            raise

        guard.record(True)
        return True
