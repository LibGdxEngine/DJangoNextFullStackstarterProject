#!/usr/bin/env python
"""
Development seed script for Mobser.
Populates the local database with default admin user, demo organization, membership, and billing plans.
"""
import os
import sys
from pathlib import Path

# Add backend to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings.dev")

import django
django.setup()

from django.contrib.auth import get_user_model
from apps.organizations.models import Organization, OrganizationMember
from apps.billing.models import Plan, Customer, Subscription
from apps.notifications.models import Notification
from apps.audit.services import record_audit_log

User = get_user_model()

def seed():
    print("🌱 Seeding Mobser development database...")

    # 1. Superuser
    username = os.environ.get("DEV_SUPERUSER_USER", "admin")
    email = os.environ.get("DEV_SUPERUSER_EMAIL", "admin@mobser.local")
    password = os.environ.get("DEV_SUPERUSER_PASSWORD", "admin12345")

    user, created = User.objects.get_or_create(
        username=username,
        defaults={
            "email": email,
            "first_name": "Admin",
            "last_name": "Mobser",
            "is_staff": True,
            "is_superuser": True,
        }
    )
    if created:
        user.set_password(password)
        user.save()
        print(f"  ✓ Created superuser: {username} (pass: {password})")
    else:
        print(f"  • Superuser {username} already exists.")

    # 2. Demo Organization
    org, org_created = Organization.objects.get_or_create(
        slug="acme-corp",
        defaults={
            "name": "Acme Corporation",
            "is_active": True,
        }
    )
    if org_created:
        print(f"  ✓ Created Organization: {org.name}")
    else:
        print(f"  • Organization {org.name} already exists.")

    # 3. Organization Membership
    member, mem_created = OrganizationMember.objects.get_or_create(
        organization=org,
        user=user,
        defaults={
            "role": OrganizationMember.Role.OWNER,
        }
    )
    if mem_created:
        print(f"  ✓ Added {user.username} as OWNER of {org.name}")

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
            print(f"  ✓ Created Plan: {plan.name}")

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

    print("🎉 Database seeded successfully!")

if __name__ == "__main__":
    seed()
