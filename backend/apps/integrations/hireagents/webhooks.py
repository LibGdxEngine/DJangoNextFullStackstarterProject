import hashlib
import hmac
import logging
import secrets
from core.api_errors import error_response
from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from apps.integrations.tasks import process_hireagents_event
from .models import WebhookEvent

logger = logging.getLogger(__name__)


def verify_signature(raw_body: bytes, signature: str | None, secret: str) -> bool:
    """
    Verify HMAC-SHA256 signature against request raw body using timing-safe comparison.
    """
    if not secret:
        return True
    if not signature:
        return False

    expected_signature = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    # Handle signatures formatted as 'sha256=...'
    if signature.startswith("sha256="):
        signature = signature[len("sha256="):]

    return secrets.compare_digest(signature, expected_signature)


@api_view(["POST"])
@permission_classes([AllowAny])
def hireagents_webhook_view(request, connection: str):
    """
    Webhook receiver endpoint for HireAgents events:
    POST /api/v1/webhooks/hireagents/<str:connection>/

    Verifies API keys/signatures, persists WebhookEvent to database,
    enqueues asynchronous Celery processing, and returns HTTP 200 immediately.
    """
    connections = getattr(settings, "HIREAGENTS_CONNECTIONS", {})
    conn_config = connections.get(connection)

    if not conn_config:
        logger.warning("HireAgents webhook received for unknown connection: '%s'", connection)
        return error_response(
            "not_found", f"Unknown connection '{connection}'",
            status=status.HTTP_404_NOT_FOUND,
        )

    expected_api_key = conn_config.get("webhook_api_key", "")
    received_api_key = request.headers.get("X-Api-Key", "")

    if expected_api_key:
        if not received_api_key or not secrets.compare_digest(received_api_key, expected_api_key):
            logger.warning("Invalid or missing X-Api-Key for HireAgents webhook '%s'", connection)
            return error_response(
                "authentication_failed", "Unauthorized: Invalid API key",
                status=status.HTTP_401_UNAUTHORIZED,
            )

    signing_secret = conn_config.get("webhook_signing_secret", "")
    if signing_secret:
        received_signature = request.headers.get("X-HireAgents-Signature")
        if not verify_signature(request.body, received_signature, signing_secret):
            logger.warning("Invalid X-HireAgents-Signature for HireAgents webhook '%s'", connection)
            return error_response(
                "authentication_failed", "Unauthorized: Invalid payload signature",
                status=status.HTTP_401_UNAUTHORIZED,
            )

    payload = request.data if isinstance(request.data, dict) else {}
    event_type = payload.get("event") or payload.get("event_type") or payload.get("type") or "generic"
    provider_event_id = str(payload.get("id") or payload.get("event_id") or "")

    event_defaults = {
        "event_type": event_type,
        "payload": payload,
        "status": WebhookEvent.Status.PENDING,
    }

    # A redelivered event reuses the stored row rather than queueing a second time.
    if provider_event_id:
        event, created = WebhookEvent.objects.get_or_create(
            provider="hireagents",
            connection=connection,
            provider_event_id=provider_event_id,
            defaults=event_defaults,
        )
    else:
        event = WebhookEvent.objects.create(
            provider="hireagents",
            connection=connection,
            provider_event_id=None,
            **event_defaults,
        )
        created = True

    if created:
        transaction.on_commit(lambda: process_hireagents_event.delay(str(event.id)))
    else:
        logger.info("Duplicate HireAgents event %s ignored", provider_event_id)

    return Response(
        {"status": "received", "event_id": str(event.id)},
        status=status.HTTP_200_OK,
    )
