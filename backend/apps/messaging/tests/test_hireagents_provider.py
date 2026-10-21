from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from apps.messaging.providers.hireagents import HireAgentsWhatsAppProvider


@override_settings(HIREAGENTS_BASE_URL="https://hireagents.example.test/")
class HireAgentsProviderTests(SimpleTestCase):
    def _client(self, mock_client_cls):
        client = MagicMock()
        client.post.return_value.json.return_value = {"id": "msg-1"}
        mock_client_cls.return_value.__enter__.return_value = client
        return client

    @patch("apps.messaging.providers.hireagents.httpx.Client")
    def test_send_text_posts_to_channel_with_api_key_header(self, mock_client_cls):
        client = self._client(mock_client_cls)
        provider = HireAgentsWhatsAppProvider({"channel_id": "70", "api_key": "secret"})

        result = provider.send_text(to="+201234567890", text="Hello")

        self.assertEqual(result, {"id": "msg-1"})
        url = client.post.call_args.args[0]
        kwargs = client.post.call_args.kwargs
        self.assertEqual(url, "https://hireagents.example.test/api/v1/channels/70/messages/")
        self.assertEqual(kwargs["json"], {"to": "+201234567890", "text": "Hello"})
        self.assertEqual(kwargs["headers"]["X-Api-Key"], "secret")

    @patch("apps.messaging.providers.hireagents.httpx.Client")
    def test_send_template_wraps_name_and_parameters(self, mock_client_cls):
        client = self._client(mock_client_cls)
        provider = HireAgentsWhatsAppProvider({"channel_id": "70", "api_key": "secret"})

        provider.send_template(to="+201234567890", template_name="class_reminder", variables={"student": "Yusuf"})

        self.assertEqual(
            client.post.call_args.kwargs["json"],
            {"to": "+201234567890", "template": {"name": "class_reminder", "parameters": {"student": "Yusuf"}}},
        )

    @patch("apps.messaging.providers.hireagents.httpx.Client")
    def test_missing_credentials_never_call_the_provider(self, mock_client_cls):
        provider = HireAgentsWhatsAppProvider({"channel_id": "70", "api_key": ""})

        result = provider.send_text(to="+201234567890", text="Hello")

        self.assertEqual(result["status"], "mock_sent")
        mock_client_cls.assert_not_called()
