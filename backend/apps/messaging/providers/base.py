from typing import Any, Dict, Protocol


class WhatsAppProvider(Protocol):
    """
    Protocol definition for any WhatsApp provider adapter.
    Decouples consumer code from provider-specific APIs (HireAgents, Twilio, Meta Cloud API, etc.).
    """

    def send_template(
        self,
        *,
        to: str,
        template_name: str,
        variables: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Send a templated WhatsApp message to the specified recipient.
        """
        ...

    def send_text(self, *, to: str, text: str) -> Dict[str, Any]:
        """
        Send a free-form text message to the specified recipient.
        """
        ...
