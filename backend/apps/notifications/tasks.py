from celery import shared_task
from datetime import timedelta
from django.conf import settings
from django.utils import timezone
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
        logger.info(f"Notification {notification.id} created for user {user.email}")
        return str(notification.id)
    except Exception as e:
        logger.error(f"Failed to create notification: {e}")
        return None


@shared_task
def send_scheduled_reports():
    """
    Fans out a periodic activity digest to the owners and admins of every
    active organization.
    """
    from apps.organizations.models import Organization, OrganizationMember

    since = timezone.now() - timedelta(days=settings.SCHEDULED_REPORT_PERIOD_DAYS)
    dispatched = 0

    for organization in Organization.objects.filter(is_active=True):
        try:
            title, message = build_organization_digest(organization, since)
        except Exception as e:
            logger.error(f"Failed to build digest for organization {organization.pk}: {e}")
            continue

        recipient_ids = organization.memberships.filter(
            role__in=[OrganizationMember.Role.OWNER, OrganizationMember.Role.ADMIN]
        ).values_list('user_id', flat=True)

        for recipient_id in recipient_ids:
            send_notification_task.delay(str(recipient_id), title, message, 'INFO')
            dispatched += 1

    logger.info(f"send_scheduled_reports dispatched {dispatched} digest notification(s).")
    return dispatched


def build_organization_digest(organization, since):
    """
    Builds the (title, message) pair summarising one organization's activity.
    """
    from apps.audit.models import AuditLog
    from apps.billing.models import Subscription
    from apps.organizations.models import Invitation

    new_members = organization.memberships.filter(created_at__gte=since).count()
    pending_invitations = organization.invitations.filter(
        status=Invitation.Status.PENDING
    ).count()
    audit_events = AuditLog.objects.filter(
        created_at__gte=since,
        actor__organization_memberships__organization=organization,
    ).distinct().count()

    subscription = Subscription.objects.filter(
        customer__organization=organization
    ).order_by('-created_at').first()
    subscription_status = subscription.get_status_display() if subscription else 'No subscription'

    title = f"Activity report for {organization.name}"
    message = (
        f"Since {since:%Y-%m-%d}:\n"
        f"- New members: {new_members}\n"
        f"- Pending invitations: {pending_invitations}\n"
        f"- Audit events: {audit_events}\n"
        f"- Subscription: {subscription_status}"
    )
    return title, message
