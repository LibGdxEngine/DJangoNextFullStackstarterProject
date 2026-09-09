"""Organization invitation maintenance."""

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="apps.organizations.tasks.expire_pending_invitations")
def expire_pending_invitations():
    """Flip invitations past their expiry so stale tokens stop being redeemable."""
    from apps.organizations.models import Invitation

    # update() bypasses auto_now, so updated_at is set explicitly.
    now = timezone.now()
    expired = Invitation.objects.filter(
        status=Invitation.Status.PENDING,
        expires_at__lt=now,
    ).update(status=Invitation.Status.EXPIRED, updated_at=now)

    logger.info("Expired %s pending invitations", expired)
    return expired
