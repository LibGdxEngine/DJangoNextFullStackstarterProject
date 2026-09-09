from django.test import TestCase

from core.celery import app as celery_app

from apps.accounts.models import User
from apps.notifications.models import Notification
from apps.notifications.tasks import send_scheduled_reports
from apps.organizations.models import Organization, OrganizationMember


class SendScheduledReportsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # override_settings cannot reach Celery's already-finalised conf.
        cls._previous_eager = celery_app.conf.task_always_eager
        celery_app.conf.task_always_eager = True

    @classmethod
    def tearDownClass(cls):
        celery_app.conf.task_always_eager = cls._previous_eager
        super().tearDownClass()

    def setUp(self):
        self.organization = Organization.objects.create(name="Acme", slug="acme")
        self.owner = self._create_member(
            "owner@example.com", "+201012345681", OrganizationMember.Role.OWNER
        )
        self.admin = self._create_member(
            "admin@example.com", "+201012345682", OrganizationMember.Role.ADMIN
        )
        self.member = self._create_member(
            "member@example.com", "+201012345683", OrganizationMember.Role.MEMBER
        )

    def _create_member(self, email, phone, role):
        user = User.objects.create_user(email=email, phone=phone, password="Password123!")
        OrganizationMember.objects.create(
            organization=self.organization,
            user=user,
            role=role,
        )
        return user

    def test_dispatches_to_owners_only(self):
        queued = send_scheduled_reports()

        self.assertEqual(queued, 1)
        self.assertEqual(Notification.objects.filter(recipient=self.owner).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.admin).count(), 0)
        self.assertEqual(Notification.objects.filter(recipient=self.member).count(), 0)

    def test_digest_mentions_the_organization(self):
        send_scheduled_reports()

        notification = Notification.objects.filter(recipient=self.owner).first()
        self.assertIsNotNone(notification)
        self.assertIn(self.organization.name, notification.title)
        self.assertIn("member(s)", notification.message)

    def test_rerun_does_not_duplicate_the_digest(self):
        send_scheduled_reports()
        send_scheduled_reports()

        self.assertEqual(Notification.objects.filter(recipient=self.owner).count(), 1)

    def test_skips_inactive_organizations(self):
        self.organization.is_active = False
        self.organization.save(update_fields=["is_active"])

        self.assertEqual(send_scheduled_reports(), 0)
        self.assertEqual(Notification.objects.count(), 0)
