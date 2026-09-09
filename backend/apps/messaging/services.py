import logging
from typing import Any, Dict
from django.conf import settings
from .models import OutboundMessage
from .providers.base import WhatsAppProvider
from .providers.hireagents import HireAgentsWhatsAppProvider

logger = logging.getLogger(__name__)


def get_whatsapp_provider(connection_name: str = "auth") -> WhatsAppProvider:
    """
    Factory to retrieve the WhatsApp provider configured for a named connection.
    Defaults to 'auth' connection.
    """
    connections = getattr(settings, "HIREAGENTS_CONNECTIONS", {})
    connection_config = connections.get(connection_name, {})
    return HireAgentsWhatsAppProvider(connection=connection_config)


def send_whatsapp_verification(
    *,
    to: str,
    code: str,
    purpose: str = "signup",
    connection_name: str = "auth",
    idempotency_key: str | None = None,
) -> Dict[str, Any]:
    """
    High-level messaging service for dispatching verification codes over WhatsApp.
    The caller has no awareness of whether the underlying transport is HireAgents,
    Twilio, Meta Cloud API, or SMS.

    Passing an idempotency_key makes the call safe to repeat: a key that already reached the
    provider returns the original result instead of sending a second message.
    """
    template_name = getattr(settings, "WHATSAPP_AUTH_TEMPLATE", "auth_verification_otp")
    variables = {
        "code": code,
        "purpose": purpose,
    }

    log_defaults = {
        "provider": "hireagents",
        "connection": connection_name,
        "channel": "whatsapp",
        "destination": to,
        "template_name": template_name,
        "status": OutboundMessage.Status.QUEUED,
    }

    # Log outbound attempt
    if idempotency_key:
        message_log, _ = OutboundMessage.objects.get_or_create(
            idempotency_key=idempotency_key,
            defaults=log_defaults,
        )
        if message_log.status == OutboundMessage.Status.SENT:
            logger.info(
                "WhatsApp verification for key %s was already delivered; skipping provider call",
                idempotency_key,
            )
            return {"id": message_log.provider_message_id, "deduplicated": True}
    else:
        message_log = OutboundMessage.objects.create(**log_defaults)

    try:
        provider = get_whatsapp_provider(connection_name=connection_name)
        result = provider.send_template(
            to=to,
            template_name=template_name,
            variables=variables,
        )

        message_log.status = OutboundMessage.Status.SENT
        message_log.provider_message_id = str(result.get("id") or result.get("message_id") or "")
        message_log.save(update_fields=["status", "provider_message_id", "updated_at"])
        return result
    except Exception as exc:
        message_log.status = OutboundMessage.Status.FAILED
        message_log.error_message = str(exc)
        message_log.save(update_fields=["status", "error_message", "updated_at"])
        logger.error("Failed to send WhatsApp verification to %s: %s", to, exc)
        raise
