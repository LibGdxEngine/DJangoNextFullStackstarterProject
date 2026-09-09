"""Account maintenance sweeps.

Both tasks are bulk deletes and therefore safe to run repeatedly.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="apps.accounts.tasks.purge_expired_jwt_tokens")
def purge_expired_jwt_tokens():
    """Drop outstanding refresh tokens that expired beyond the retention window."""
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

    cutoff = timezone.now() - timedelta(days=settings.EXPIRED_TOKEN_RETENTION_DAYS)
    deleted, _ = OutstandingToken.objects.filter(expires_at__lt=cutoff).delete()
    logger.info("Deleted %s expired outstanding tokens", deleted)
    return deleted


@shared_task(name="apps.accounts.tasks.purge_expired_verification_challenges")
def purge_expired_verification_challenges():
    """Drop verification challenges that can no longer be used."""
    from apps.accounts.models import VerificationChallenge

    cutoff = timezone.now() - timedelta(days=settings.VERIFICATION_CHALLENGE_RETENTION_DAYS)
    deleted, _ = VerificationChallenge.objects.filter(expires_at__lt=cutoff).delete()
    logger.info("Deleted %s expired verification challenges", deleted)
    return deleted
