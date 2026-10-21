from io import StringIO
from django.core.management import call_command
from django.test import TestCase
from apps.organizations.models import Organization
from product.academy.models import AcademySettings


class EnsureAcademyCommandTests(TestCase):
    def test_creates_academy_once(self):
        call_command("ensure_academy", stdout=StringIO())
        out = StringIO()
        call_command("ensure_academy", stdout=out)
        self.assertIn("exists", out.getvalue())
        org = Organization.objects.get(slug="imam-malek")
        self.assertEqual(org.name, "Imam Malek Academy")
        settings = AcademySettings.objects.get(organization=org)
        self.assertEqual((settings.domain, settings.language), ("malek.ic-mobile.tech", "ar"))
        self.assertEqual(Organization.objects.filter(slug="imam-malek").count(), 1)
