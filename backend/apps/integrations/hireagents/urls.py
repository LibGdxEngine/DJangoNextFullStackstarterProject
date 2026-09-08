from django.urls import path
from .webhooks import hireagents_webhook_view

app_name = "hireagents_webhooks"

urlpatterns = [
    path("<str:connection>/", hireagents_webhook_view, name="webhook"),
]
