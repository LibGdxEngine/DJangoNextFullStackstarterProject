"""Billing tasks.

Money movement is the canonical example of work that must never happen twice, so
``charge_subscription`` refuses to run without an explicit idempotency key and hands that
same key to the payment provider.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.common.tasks import PermanentTaskError, idempotent

logger = logging.getLogger(__name__)


def charge_via_provider(*, customer_reference: str, amount_cents: int, currency: str, idempotency_key: str):
    """Integration point for the payment provider.

    Pass ``idempotency_key`` straight through as the provider's Idempotency-Key header so a
    retry that reaches the provider twice still results in a single charge.
    """
    raise PermanentTaskError(
        "No payment provider is wired up; implement charge_via_provider before charging customers."
    )


@shared_task(bind=True, name="apps.billing.tasks.sync_subscriptions")
def sync_subscriptions(self):
    """Advance subscriptions through the lapse then cancel lifecycle."""
    from apps.billing.models import Subscription

    now = timezone.now()
    cutoff = now - timedelta(hours=settings.SUBSCRIPTION_PAST_DUE_GRACE_HOURS)

    # Cancelling first means a subscription that lapses in this same run still gets
    # a full grace window before it can be cancelled on a later run.
    # update() bypasses auto_now, so updated_at is set explicitly.
    canceled = Subscription.objects.filter(
        status=Subscription.Status.PAST_DUE,
        current_period_end__lt=cutoff,
    ).update(status=Subscription.Status.CANCELED, updated_at=now)

    lapsed = Subscription.objects.filter(
        status__in=[Subscription.Status.ACTIVE, Subscription.Status.TRIALING],
        current_period_end__lt=now,
    ).update(status=Subscription.Status.PAST_DUE, updated_at=now)

    logger.info(
        "Marked %s subscriptions past due and canceled %s past the grace window", lapsed, canceled
    )
    return {"past_due": lapsed, "canceled": canceled}


@shared_task(bind=True, name="apps.billing.tasks.charge_subscription")
def charge_subscription(self, subscription_id: str, idempotency_key: str):
    """Charge a subscription exactly once for the supplied key."""
    from apps.billing.models import Subscription

    if not idempotency_key:
        raise PermanentTaskError("charge_subscription requires an explicit idempotency key")

    try:
        subscription = Subscription.objects.select_related("customer", "plan").get(id=subscription_id)
    except Subscription.DoesNotExist:
        logger.error("Subscription %s does not exist; nothing to charge", subscription_id)
        return None

    key = self.idempotency_key(subscription_id, idempotency_key)
    with idempotent(key, task_name=self.name, task_id=self.request.id) as guard:
        if guard.is_duplicate:
            logger.info("Charge for key %s already completed; skipping", idempotency_key)
            return guard.result

        receipt = charge_via_provider(
            customer_reference=subscription.customer.stripe_customer_id,
            amount_cents=subscription.plan.price_cents,
            currency=subscription.plan.currency,
            idempotency_key=idempotency_key,
        )
        guard.record(receipt)
        return receipt
