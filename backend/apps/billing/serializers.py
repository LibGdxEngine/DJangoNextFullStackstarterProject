from rest_framework import serializers
from .models import Plan, Subscription, Customer

class PlanSerializer(serializers.ModelSerializer):
    price_dollars = serializers.SerializerMethodField()

    class Meta:
        model = Plan
        fields = ['id', 'name', 'slug', 'price_cents', 'price_dollars', 'currency', 'interval', 'features', 'is_active']

    def get_price_dollars(self, obj) -> float:
        return obj.price_cents / 100.0


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)
    organization_name = serializers.CharField(source='customer.organization.name', read_only=True)

    class Meta:
        model = Subscription
        fields = ['id', 'organization_name', 'plan', 'status', 'current_period_end', 'created_at']
        read_only_fields = ['id', 'created_at']
