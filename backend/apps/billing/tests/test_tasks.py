from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.billing.models import Customer, Plan, Subscription
from apps.billing.tasks import sync_subscriptions
from apps.organizations.models import Organization


@override_settings(SUBSCRIPTION_PAST_DUE_GRACE_HOURS=24)
class SyncSubscriptionsTests(TestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Acme", slug="acme")
        self.customer = Customer.objects.create(
            organization=self.organization,
            stripe_customer_id="cus_test",
        )
        self.plan = Plan.objects.create(name="Pro", slug="pro", price_cents=1000)

    def _create_subscription(self, status, current_period_end):
        return Subscription.objects.create(
            customer=self.customer,
            plan=self.plan,
            status=status,
            current_period_end=current_period_end,
        )

    def test_lapsed_active_subscription_becomes_past_due(self):
        subscription = self._create_subscription(
            Subscription.Status.ACTIVE,
            timezone.now() - timedelta(hours=1),
        )

        result = sync_subscriptions()

        self.assertEqual(result, {"past_due": 1, "canceled": 0})
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.PAST_DUE)

    def test_lapsed_trialing_subscription_becomes_past_due(self):
        subscription = self._create_subscription(
            Subscription.Status.TRIALING,
            timezone.now() - timedelta(hours=1),
        )

        sync_subscriptions()

        subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.PAST_DUE)

    def test_grace_window_is_honoured_before_cancelling(self):
        subscription = self._create_subscription(
            Subscription.Status.ACTIVE,
            timezone.now() - timedelta(days=3),
        )

        # First run only lapses it, so the grace window is never skipped.
        self.assertEqual(sync_subscriptions(), {"past_due": 1, "canceled": 0})
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.PAST_DUE)

        self.assertEqual(sync_subscriptions(), {"past_due": 0, "canceled": 1})
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.CANCELED)

    def test_past_due_within_grace_is_not_cancelled(self):
        subscription = self._create_subscription(
            Subscription.Status.PAST_DUE,
            timezone.now() - timedelta(hours=1),
        )

        self.assertEqual(sync_subscriptions(), {"past_due": 0, "canceled": 0})
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.PAST_DUE)

    def test_live_subscription_is_untouched(self):
        subscription = self._create_subscription(
            Subscription.Status.ACTIVE,
            timezone.now() + timedelta(days=10),
        )

        self.assertEqual(sync_subscriptions(), {"past_due": 0, "canceled": 0})
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.ACTIVE)

    def test_subscription_without_period_end_is_untouched(self):
        subscription = self._create_subscription(Subscription.Status.TRIALING, None)

        self.assertEqual(sync_subscriptions(), {"past_due": 0, "canceled": 0})
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.TRIALING)
