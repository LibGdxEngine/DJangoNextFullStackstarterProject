from django.db import models
from apps.common.models import BaseModel
from apps.organizations.models import Organization

class Customer(BaseModel):
    organization = models.OneToOneField(
        Organization,
        on_delete=models.CASCADE,
        related_name='billing_customer'
    )
    stripe_customer_id = models.CharField(max_length=255, unique=True, db_index=True)

    def __str__(self):
        return f"Customer: {self.organization.name} ({self.stripe_customer_id})"


class Plan(BaseModel):
    class Interval(models.TextChoices):
        MONTHLY = 'month', 'Monthly'
        YEARLY = 'year', 'Yearly'

    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=100, unique=True)
    price_cents = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=10, default='usd')
    interval = models.CharField(max_length=10, choices=Interval.choices, default=Interval.MONTHLY)
    features = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.name} (${self.price_cents / 100:.2f}/{self.interval})"


class Subscription(BaseModel):
    class Status(models.TextChoices):
        TRIALING = 'trialing', 'Trialing'
        ACTIVE = 'active', 'Active'
        PAST_DUE = 'past_due', 'Past Due'
        CANCELED = 'canceled', 'Canceled'

    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name='subscriptions'
    )
    plan = models.ForeignKey(
        Plan,
        on_delete=models.PROTECT,
        related_name='subscriptions'
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TRIALING)
    stripe_subscription_id = models.CharField(max_length=255, blank=True, null=True)
    current_period_end = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.customer.organization.name} - {self.plan.name} ({self.status})"
