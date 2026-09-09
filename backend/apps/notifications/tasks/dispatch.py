import logging

from celery import shared_task
from django.contrib.auth import get_user_model

from apps.common.tasks import build_key

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="apps.notifications.tasks.send_notification")
def send_notification_task(
    self,
    recipient_id,
    title,
    message,
    notification_type="INFO",
    link=None,
    dedupe_key=None,
):
    """
    Persist and dispatch a notification.

    The dedupe key is what makes a redelivery safe: without one the payload itself is
    fingerprinted, so the same notification is never written twice.
    """
    from apps.notifications.models import Notification

    User = get_user_model()
    try:
        user = User.objects.get(id=recipient_id)
    except User.DoesNotExist:
        # Nothing to retry: the recipient is gone.
        logger.error("Cannot create notification, user %s does not exist", recipient_id)
        return None

    key = dedupe_key or build_key(self.name, recipient_id, title, message, notification_type, link)
    notification, created = Notification.objects.get_or_create(
        dedupe_key=key,
        defaults={
            "recipient": user,
            "title": title,
            "message": message,
            "notification_type": notification_type,
            "link": link,
        },
    )
    if created:
        logger.info("Notification %s created for user %s", notification.id, user.email)
    else:
        logger.info("Notification for key %s already exists; skipping", key)
    return str(notification.id)
