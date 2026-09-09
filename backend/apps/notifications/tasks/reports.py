import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.common.tasks import build_key

from .dispatch import send_notification_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="apps.notifications.tasks.send_scheduled_reports")
def send_scheduled_reports(self):
    """
    Fan out the periodic per-organization digest.

    The scheduled task stays short by delegating each recipient to its own task, and every
    digest carries a key derived from the organization and period so a re-run writes nothing new.
    """
    from apps.organizations.models import Organization, OrganizationMember

    period_end = timezone.now()
    period_start = period_end - timedelta(days=settings.SCHEDULED_REPORT_PERIOD_DAYS)
    period_stamp = period_end.date().isoformat()

    queued = 0
    for organization in Organization.objects.filter(is_active=True).iterator():
        new_members = OrganizationMember.objects.filter(
            organization=organization,
            created_at__gte=period_start,
        ).count()

        owners = OrganizationMember.objects.filter(
            organization=organization,
            role=OrganizationMember.Role.OWNER,
        ).select_related("user")

        for owner in owners:
            send_notification_task.delay(
                recipient_id=str(owner.user_id),
                title=f"Weekly summary for {organization.name}",
                message=(
                    f"In the last {settings.SCHEDULED_REPORT_PERIOD_DAYS} days your organization "
                    f"gained {new_members} member(s)."
                ),
                notification_type="INFO",
                dedupe_key=build_key(
                    "scheduled-report", str(organization.id), str(owner.user_id), period_stamp
                ),
            )
            queued += 1

    logger.info("Queued %s scheduled report notifications", queued)
    return queued
