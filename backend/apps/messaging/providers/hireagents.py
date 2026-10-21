import logging
from typing import Any, Dict
import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


class HireAgentsWhatsAppProvider:
    """
    HireAgents WhatsApp provider adapter implementing the WhatsAppProvider protocol.
    Sends through the HireAgents channel messages API:

        POST {base}/api/v1/channels/<channel_id>/messages/
        X-Api-Key: <key with messages:send>
        {"to": "+2010...", "text": "..."}  or  {"to": "+2010...", "template": {...}}
    """

    def __init__(self, connection: Dict[str, Any]):
        self.base_url = getattr(
            settings, "HIREAGENTS_BASE_URL", "https://hireagents.blinksolutions.tech"
        ).rstrip("/")
        self.channel_id = connection.get("channel_id", "")
        self.api_key = connection.get("api_key", "")

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.channel_id)

    def _headers(self) -> Dict[str, str]:
        return {
            "X-Api-Key": self.api_key,
            # Kept for connections provisioned before X-Api-Key was the documented header.
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _post(self, payload: Dict[str, Any], *, kind: str) -> Dict[str, Any]:
        # Without live credentials (local dev, CI) log and return a mock result instead of calling out.
        if not self.configured:
            logger.warning("HireAgents credentials missing; using development mock dispatch.")
            return {"status": "mock_sent", "to": payload["to"], kind: payload.get(kind)}

        url = f"{self.base_url}/api/v1/channels/{self.channel_id}/messages/"
        logger.info("Sending HireAgents WhatsApp %s message", kind)
        with httpx.Client(timeout=10.0) as client:
            response = client.post(url, json=payload, headers=self._headers())
            response.raise_for_status()
            return response.json()

    def send_template(
        self,
        *,
        to: str,
        template_name: str,
        variables: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Send a pre-approved WhatsApp template message."""
        return self._post(
            {"to": to, "template": {"name": template_name, "parameters": variables}},
            kind="template",
        )

    def send_text(self, *, to: str, text: str) -> Dict[str, Any]:
        """Send a free-form text message (only delivered inside WhatsApp's 24-hour service window)."""
        return self._post({"to": to, "text": text}, kind="text")
