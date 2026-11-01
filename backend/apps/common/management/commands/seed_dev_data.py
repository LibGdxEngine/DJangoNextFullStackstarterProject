"""
Development seed for Mobser.
Populates the local database with a default admin user, demo organization, membership, and billing plans.
"""
import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.accounts.models import UserStatus
from apps.audit.services import record_audit_log
from apps.billing.models import Customer, Plan, Subscription
from apps.notifications.models import Notification
from apps.organizations.models import Organization, OrganizationMember

User = get_user_model()


class Command(BaseCommand):
    help = "Seed the development database with a demo admin, organization, and billing plans."

    def handle(self, *args, **options):
        # The admin has a well-known password, so never seed outside development.
        if not settings.DEBUG:
            raise CommandError("seed_dev_data only runs with DEBUG enabled.")

        self.stdout.write("🌱 Seeding Mobser development database...")

        # 1. Superuser, verified so it can sign in without phone onboarding.
        email = os.environ.get("DEV_SUPERUSER_EMAIL", "admin@mobser.local")
        phone = os.environ.get("DEV_SUPERUSER_PHONE", "+201000000000")
        password = os.environ.get("DEV_SUPERUSER_PASSWORD", "admin12345")

        now = timezone.now()
        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "phone": phone,
                "first_name": "Admin",
                "last_name": "Mobser",
                "is_staff": True,
                "is_superuser": True,
                "status": UserStatus.ACTIVE,
                "phone_verified_at": now,
                "email_verified_at": now,
            }
        )
        if created:
            user.set_password(password)
            user.save()
            self.stdout.write(f"  ✓ Created superuser: {email} / {phone} (pass: {password})")
        else:
            self.stdout.write(f"  • Superuser {email} already exists.")

        # 2. Demo Organization
        org, org_created = Organization.objects.get_or_create(
            slug="acme-corp",
            defaults={
                "name": "Acme Corporation",
                "is_active": True,
            }
        )
        if org_created:
            self.stdout.write(f"  ✓ Created Organization: {org.name}")
        else:
            self.stdout.write(f"  • Organization {org.name} already exists.")

        # 3. Organization Membership
        member, mem_created = OrganizationMember.objects.get_or_create(
            organization=org,
            user=user,
            defaults={
                "role": OrganizationMember.Role.OWNER,
            }
        )
        if mem_created:
            self.stdout.write(f"  ✓ Added {user.email} as OWNER of {org.name}")

        # 4. Billing Plans
        plans_data = [
            {"name": "Free Tier", "slug": "free", "price_cents": 0, "interval": Plan.Interval.MONTHLY, "features": ["1 User", "Basic Analytics"]},
            {"name": "Pro Monthly", "slug": "pro-monthly", "price_cents": 2900, "interval": Plan.Interval.MONTHLY, "features": ["Unlimited Users", "Priority Celery Queues", "Audit Logs"]},
            {"name": "Enterprise Yearly", "slug": "enterprise-yearly", "price_cents": 29000, "interval": Plan.Interval.YEARLY, "features": ["Custom SLAs", "Dedicated Workers", "Direct Support"]},
        ]
        for p in plans_data:
            plan, p_created = Plan.objects.get_or_create(
                slug=p["slug"],
                defaults=p
            )
            if p_created:
                self.stdout.write(f"  ✓ Created Plan: {plan.name}")

        # 5. Customer & Subscription
        customer, _ = Customer.objects.get_or_create(
            organization=org,
            defaults={"stripe_customer_id": f"cus_demo_{org.slug}"}
        )
        pro_plan = Plan.objects.get(slug="pro-monthly")
        Subscription.objects.get_or_create(
            customer=customer,
            defaults={
                "plan": pro_plan,
                "status": Subscription.Status.ACTIVE,
            }
        )

        # 6. Welcome Notification
        Notification.objects.get_or_create(
            recipient=user,
            title="Welcome to Mobser Platform",
            defaults={
                "message": "Your modular platform environment has been initialized with organizations, billing, and audit services.",
                "notification_type": Notification.NotificationType.SUCCESS,
            }
        )

        # 7. Audit Log
        record_audit_log(
            actor=user,
            action="SYSTEM_SEEDED",
            resource_type="system",
            resource_id="dev-seed",
            metadata={"environment": "dev", "version": "1.0-modular"}
        )

        self.stdout.write("🎉 Database seeded successfully!")
