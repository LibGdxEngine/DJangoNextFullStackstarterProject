from django.contrib import admin
from .models import Customer, Plan, Subscription

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('organization', 'stripe_customer_id', 'created_at')
    search_fields = ('organization__name', 'stripe_customer_id')

@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'price_cents', 'currency', 'interval', 'is_active')
    list_filter = ('interval', 'is_active')
    search_fields = ('name', 'slug')

@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('customer', 'plan', 'status', 'current_period_end', 'created_at')
    list_filter = ('status',)
    search_fields = ('customer__organization__name', 'stripe_subscription_id')
