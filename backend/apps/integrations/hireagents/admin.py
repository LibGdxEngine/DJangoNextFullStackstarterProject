from django.contrib import admin
from .models import WebhookEvent


@admin.register(WebhookEvent)
class WebhookEventAdmin(admin.ModelAdmin):
    list_display = ("id", "provider", "connection", "event_type", "status", "received_at", "processed_at")
    list_filter = ("provider", "connection", "status", "event_type")
    search_fields = ("id", "provider_event_id", "event_type")
    readonly_fields = ("id", "received_at", "processed_at")
