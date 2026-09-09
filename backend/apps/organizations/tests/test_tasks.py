from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.organizations.models import Invitation, Organization
from apps.organizations.tasks import expire_pending_invitations


class ExpirePendingInvitationsTests(TestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Acme", slug="acme")

    def _create_invitation(self, email, status, expires_at):
        return Invitation.objects.create(
            organization=self.organization,
            email=email,
            status=status,
            expires_at=expires_at,
        )

    def test_expires_only_lapsed_pending_invitations(self):
        lapsed = self._create_invitation(
            "lapsed@example.com",
            Invitation.Status.PENDING,
            timezone.now() - timedelta(days=1),
        )
        live = self._create_invitation(
            "live@example.com",
            Invitation.Status.PENDING,
            timezone.now() + timedelta(days=1),
        )

        expired = expire_pending_invitations()

        self.assertEqual(expired, 1)
        lapsed.refresh_from_db()
        live.refresh_from_db()
        self.assertEqual(lapsed.status, Invitation.Status.EXPIRED)
        self.assertEqual(live.status, Invitation.Status.PENDING)

    def test_leaves_accepted_invitations_untouched(self):
        accepted = self._create_invitation(
            "accepted@example.com",
            Invitation.Status.ACCEPTED,
            timezone.now() - timedelta(days=5),
        )

        self.assertEqual(expire_pending_invitations(), 0)
        accepted.refresh_from_db()
        self.assertEqual(accepted.status, Invitation.Status.ACCEPTED)

    def test_defaults_apply_a_future_expiry_and_unique_token(self):
        first = Invitation.objects.create(
            organization=self.organization,
            email="first@example.com",
        )
        second = Invitation.objects.create(
            organization=self.organization,
            email="second@example.com",
        )

        self.assertGreater(first.expires_at, timezone.now())
        self.assertNotEqual(first.token, second.token)
        self.assertEqual(expire_pending_invitations(), 0)
