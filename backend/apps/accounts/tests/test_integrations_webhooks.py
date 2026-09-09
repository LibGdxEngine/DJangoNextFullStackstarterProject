from unittest.mock import patch
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status
from apps.integrations.hireagents.models import WebhookEvent
from apps.integrations.tasks import process_hireagents_event


TEST_CONNECTIONS = {
    "auth": {
        "channel_id": "14",
        "api_key": "test-api-key",
        "webhook_api_key": "test-auth-webhook-secret-key",
        "webhook_signing_secret": "",
    },
}


@override_settings(HIREAGENTS_CONNECTIONS=TEST_CONNECTIONS)
class HireAgentsWebhookTests(TestCase):
    def test_unknown_connection_returns_404(self):
        url = reverse("hireagents-webhooks:webhook", kwargs={"connection": "nonexistent"})
        res = self.client.post(url, {}, content_type="application/json")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res.json()["error"]["code"], "not_found")

    def test_invalid_api_key_returns_401(self):
        url = reverse("hireagents-webhooks:webhook", kwargs={"connection": "auth"})
        res = self.client.post(
            url,
            {"event": "message.sent"},
            content_type="application/json",
            HTTP_X_API_KEY="wrong-key",
        )
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.json()["error"]["code"], "authentication_failed")

    @patch("apps.integrations.hireagents.webhooks.process_hireagents_event.delay")
    def test_valid_webhook_persists_event_and_enqueues_worker(self, mock_delay):
        url = reverse("hireagents-webhooks:webhook", kwargs={"connection": "auth"})
        payload = {
            "id": "msg_evt_12345",
            "event": "message.sent",
            "to": "+201039811349",
            "status": "delivered",
        }
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(
                url,
                payload,
                content_type="application/json",
                HTTP_X_API_KEY="test-auth-webhook-secret-key",
            )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("event_id", res.data)

        # Check DB persistence
        event = WebhookEvent.objects.get(id=res.data["event_id"])
        self.assertEqual(event.provider, "hireagents")
        self.assertEqual(event.connection, "auth")
        self.assertEqual(event.event_type, "message.sent")
        self.assertEqual(event.status, WebhookEvent.Status.PENDING)
        self.assertEqual(event.payload["to"], "+201039811349")

        # Celery task enqueued
        mock_delay.assert_called_once_with(str(event.id))

    def test_process_hireagents_event_handler(self):
        event = WebhookEvent.objects.create(
            provider="hireagents",
            connection="auth",
            provider_event_id="evt_abc_1",
            event_type="message.sent",
            payload={"id": "msg_1", "to": "+201039811349"},
            status=WebhookEvent.Status.PENDING,
        )
        success = process_hireagents_event(str(event.id))
        self.assertTrue(success)

        event.refresh_from_db()
        self.assertEqual(event.status, WebhookEvent.Status.PROCESSED)
        self.assertIsNotNone(event.processed_at)

    def test_reprocessing_an_event_is_a_no_op(self):
        event = WebhookEvent.objects.create(
            provider="hireagents",
            connection="auth",
            provider_event_id="evt_abc_2",
            event_type="message.sent",
            payload={"id": "msg_2"},
            status=WebhookEvent.Status.PENDING,
        )
        self.assertTrue(process_hireagents_event(str(event.id)))
        self.assertFalse(process_hireagents_event(str(event.id)))

    @patch("apps.integrations.hireagents.webhooks.process_hireagents_event.delay")
    def test_replayed_delivery_is_stored_and_queued_once(self, mock_delay):
        url = reverse("hireagents-webhooks:webhook", kwargs={"connection": "auth"})
        payload = {"id": "msg_evt_dupe", "event": "message.sent"}

        for _ in range(2):
            with self.captureOnCommitCallbacks(execute=True):
                res = self.client.post(
                    url,
                    payload,
                    content_type="application/json",
                    HTTP_X_API_KEY="test-auth-webhook-secret-key",
                )
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.assertEqual(WebhookEvent.objects.filter(provider_event_id="msg_evt_dupe").count(), 1)
        mock_delay.assert_called_once()
