"""Create the academy this deployment serves, once. Safe to run on every deploy."""
from django.core.management.base import BaseCommand
from django.db import transaction
from apps.organizations.models import Organization
from product.academy.models import AcademySettings

SLUG = "imam-malek"
NAME = "Imam Malek Academy"
DOMAIN = "malek.ic-mobile.tech"


class Command(BaseCommand):
    help = "Ensure the Imam Malek Academy organization and its settings exist."

    @transaction.atomic
    def handle(self, *args, **options):
        org, created = Organization.objects.get_or_create(slug=SLUG, defaults={"name": NAME})
        AcademySettings.objects.get_or_create(
            organization=org,
            defaults={"domain": DOMAIN, "language": "ar", "timezone": "Africa/Cairo"},
        )
        self.stdout.write(f"{'created' if created else 'exists'}: {org.name} ({org.slug})")
