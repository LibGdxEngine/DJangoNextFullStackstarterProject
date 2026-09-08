import logging
from typing import Any, Dict
import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


class HireAgentsWhatsAppProvider:
    """
    HireAgents WhatsApp provider adapter implementing the WhatsAppProvider protocol.
    Translates standard template requests into HireAgents channel message API calls.
    """

    def __init__(self, connection: Dict[str, Any]):
        self.base_url = getattr(
            settings, "HIREAGENTS_BASE_URL", "https://hireagents.blinksolutions.tech"
        ).rstrip("/")
        self.channel_id = connection.get("channel_id", "")
        self.api_key = connection.get("api_key", "")

    def send_template(
        self,
        *,
        to: str,
        template_name: str,
        variables: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Send a WhatsApp template message via HireAgents Channel API.
        """
        url = f"{self.base_url}/api/v1/channels/{self.channel_id}/messages/"

        payload = {
            "to": to,
            "template": {
                "name": template_name,
                "parameters": variables,
            },
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        # If running in environment without live credentials configured, log and return mock response
        if not self.api_key or not self.channel_id:
            logger.warning(
                "HireAgents credentials missing (channel_id=%s, api_key set=%s). Mocking dispatch to %s.",
                self.channel_id,
                bool(self.api_key),
                to,
            )
            return {
                "status": "mock_sent",
                "to": to,
                "template": template_name,
                "variables": variables,
            }

        logger.info("Sending HireAgents WhatsApp template %s to %s", template_name, to)
        with httpx.Client(timeout=10.0) as client:
            response = client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
