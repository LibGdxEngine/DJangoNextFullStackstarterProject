from celery import shared_task
import time
import logging

logger = logging.getLogger(__name__)

@shared_task
def test_celery_task(x, y):
    """
    Simulates an asynchronous background task.
    """
    logger.info(f"Celery task started with params: {x}, {y}")
    time.sleep(2)
    result = x + y
    logger.info(f"Celery task completed. Result: {result}")
    return result


@shared_task
def send_notification_task(recipient_id, title, message, notification_type='INFO', link=None):
    """
    Asynchronous task to persist and dispatch a notification.
    """
    from .models import Notification
    from django.contrib.auth import get_user_model
    User = get_user_model()

    try:
        user = User.objects.get(id=recipient_id)
        notification = Notification.objects.create(
            recipient=user,
            title=title,
            message=message,
            notification_type=notification_type,
            link=link
        )
        logger.info(f"Notification {notification.id} created for user {user.username}")
        return str(notification.id)
    except Exception as e:
        logger.error(f"Failed to create notification: {e}")
        return None
