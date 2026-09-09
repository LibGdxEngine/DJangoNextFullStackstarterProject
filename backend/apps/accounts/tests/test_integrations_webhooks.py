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


class WebhookCredentialCheckTests(TestCase):
    @override_settings(RATE_LIMIT_PRODUCTION=True)
    def test_missing_or_development_credentials_are_rejected(self):
        from apps.integrations.hireagents.webhooks import check_webhook_credentials
        for credentials in ({}, {'webhook_api_key': 'dev-hireagents-auth-webhook-key'}, {'webhook_signing_secret': ' '}):
            with self.subTest(credentials=credentials), override_settings(HIREAGENTS_CONNECTIONS={'auth': credentials}):
                self.assertEqual(check_webhook_credentials()[0].id, 'rate_limits.E010')

    @override_settings(RATE_LIMIT_PRODUCTION=True, HIREAGENTS_CONNECTIONS={'auth': {'webhook_signing_secret': 'test-random-secret'}})
    def test_configured_signing_credential_passes(self):
        from apps.integrations.hireagents.webhooks import check_webhook_credentials
        self.assertEqual(check_webhook_credentials(), [])

    @override_settings(HIREAGENTS_CONNECTIONS={'disabled': {'enabled': False}})
    def test_disabled_connection_cannot_receive_unauthenticated_events(self):
        response = self.client.post('/api/v1/webhooks/hireagents/disabled/', {}, content_type='application/json')
        self.assertEqual(response.status_code, 404)
        self.assertFalse(WebhookEvent.objects.exists())


@override_settings(HIREAGENTS_CONNECTIONS=TEST_CONNECTIONS)
class WebhookAdmissionTests(TestCase):
    def post(self, event_id='test-event', key='test-auth-webhook-secret-key'):
        return self.client.post('/api/v1/webhooks/hireagents/auth/',
                                {'id': event_id, 'event': 'message.sent'},
                                content_type='application/json', HTTP_X_API_KEY=key)

    @patch('apps.integrations.hireagents.webhooks.enforce_limits')
    def test_invalid_credentials_cannot_debit_connection(self, enforce):
        self.assertEqual(self.post(key='invalid').status_code, 401)
        enforce.assert_not_called()

    @patch('apps.integrations.hireagents.webhooks.process_hireagents_event.delay')
    @patch('apps.integrations.hireagents.webhooks.enforce_limits')
    def test_duplicate_bypasses_connection_quota_and_task(self, enforce, task):
        with self.captureOnCommitCallbacks(execute=True):
            first = self.post()
            second = self.post()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.data, first.data)
        enforce.assert_called_once_with([('webhook_connection', 'auth')])
        task.assert_called_once()

    @patch('apps.integrations.hireagents.webhooks.process_hireagents_event.delay')
    def test_connection_denial_creates_no_row_or_task(self, task):
        from rest_framework.exceptions import Throttled
        with patch('apps.integrations.hireagents.webhooks.enforce_limits', side_effect=Throttled(wait=10)):
            response = self.post()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Retry-After'], '10')
        self.assertFalse(WebhookEvent.objects.exists())
        task.assert_not_called()

    def test_duplicate_still_requires_ingress_and_outage_fails_closed(self):
        from apps.common.rate_limits import RateLimitUnavailable
        from rest_framework.exceptions import Throttled
        WebhookEvent.objects.create(provider='hireagents', connection='auth', provider_event_id='test-event', event_type='message.sent')
        for failure, status_code in ((RateLimitUnavailable(), 503), (Throttled(wait=5), 429)):
            with patch('apps.common.throttling.WebhookIngressThrottle.allow_request', side_effect=failure):
                self.assertEqual(self.post().status_code, status_code)
        self.assertEqual(self.post().status_code, 200)
