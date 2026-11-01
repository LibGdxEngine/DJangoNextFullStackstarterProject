from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.organizations.models import OrganizationMember


@override_settings(DEBUG=True)
class SeedDevDataTests(APITestCase):
    def seed(self):
        call_command("seed_dev_data", stdout=StringIO())

    def test_seeded_admin_can_sign_in(self):
        self.seed()

        res = self.client.post(
            reverse("auth:login"),
            {"identifier": "admin@mobser.local", "password": "admin12345"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(
            OrganizationMember.objects.filter(
                user__email="admin@mobser.local",
                organization__slug="acme-corp",
                role=OrganizationMember.Role.OWNER,
            ).exists()
        )

    def test_rerun_is_idempotent(self):
        self.seed()
        self.seed()

        self.assertEqual(OrganizationMember.objects.filter(organization__slug="acme-corp").count(), 1)

    @override_settings(DEBUG=False)
    def test_refuses_without_debug(self):
        with self.assertRaises(CommandError):
            self.seed()
