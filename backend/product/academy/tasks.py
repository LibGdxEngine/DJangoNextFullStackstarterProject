from celery import shared_task
from django.utils import timezone
from datetime import timedelta
from . import models as m
from .services.messaging import queue_due_reminders, dispatch_message


@shared_task
def process_academy_outbox():
    queue_due_reminders()
    m.Message.objects.filter(status="sending", updated_at__lt=timezone.now() - timedelta(minutes=10)).update(status="action_required", error="Worker stopped during delivery. Reconcile with the provider.")
    for message_id in m.Message.objects.filter(status="queued", due_at__lte=timezone.now()).order_by("due_at").values_list("id", flat=True)[:200]:
        dispatch_message(message_id)
