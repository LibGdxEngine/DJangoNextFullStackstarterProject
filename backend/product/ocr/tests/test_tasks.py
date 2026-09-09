import hashlib
import hmac
import json
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.organizations.models import Organization
from product.ocr.gpu import ModelError
from product.ocr.models import OCRJob, OCRUploadReservation, OCRWebhookEvent
from product.ocr.processing import DocumentValidationError
from product.ocr.services import create_api_key, finish_job, signing_secret
from product.ocr.tasks import deliver_event, process_job, recover_jobs


@override_settings(OCR_ENABLED=True, OCR_WEBHOOK_SIGNING_KEY="test-signing-master")
class OCRTaskTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(email="tasks@example.com", phone="+201000000002", password="test")
        self.org = Organization.objects.create(name="Tasks", slug="tasks")
        self.key, _, self.secret = create_api_key(self.org, self.user, "Tasks")
        self.job = OCRJob.objects.create(
            organization=self.org, api_key=self.key, idempotency_key="request", fingerprint="a" * 64,
            storage_name="a" * 32, sha256="b" * 64, size=100, content_type="application/pdf",
            webhook_url="https://example.com/webhook",
        )
        self.delete = patch("product.ocr.tasks.delete_upload")
        self.delete_mock = self.delete.start()
        self.addCleanup(self.delete.stop)

    @patch("product.ocr.tasks.run_model", return_value={"text": "secret OCR result"})
    @patch("product.ocr.tasks.validate_document")
    def test_processing_claim_prevents_duplicate_gpu_and_persists_outbox(self, validate, model):
        process_job(str(self.job.id))
        process_job(str(self.job.id))
        model.assert_called_once()
        validate.assert_called_once()
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "succeeded")
        self.assertEqual(self.job.storage_name, "")
        self.assertEqual(self.job.result, {"text": "secret OCR result"})
        self.assertEqual(OCRWebhookEvent.objects.count(), 1)
        self.assertNotIn("secret OCR result", json.dumps(self.job.webhook_event.payload))

    @patch("product.ocr.tasks.run_model", side_effect=ModelError("model_outcome_unknown"))
    @patch("product.ocr.tasks.validate_document")
    def test_timeout_is_terminal_and_never_retries_model(self, validate, model):
        process_job(str(self.job.id))
        process_job(str(self.job.id))
        self.job.refresh_from_db()
        self.assertEqual(self.job.error_code, "model_outcome_unknown")
        self.assertEqual(self.job.status, "failed")
        model.assert_called_once()

    @patch("product.ocr.tasks.run_model")
    @patch("product.ocr.tasks.validate_document", side_effect=DocumentValidationError("unsafe_document"))
    def test_unsafe_document_never_reaches_gpu(self, validate, model):
        process_job(str(self.job.id))
        model.assert_not_called()
        self.job.refresh_from_db()
        self.assertEqual(self.job.error_code, "unsafe_document")
        self.assertEqual(self.job.status, "failed")

    @patch("product.ocr.tasks.deliver_webhook", return_value=200)
    def test_callback_signature_and_revocation_does_not_break_existing_event(self, deliver):
        finish_job(self.job, "succeeded", result={"text": "result"})
        event = self.job.webhook_event
        self.key.revoked_at = timezone.now()
        self.key.save()
        deliver_event(str(event.id))
        _, body, headers = deliver.call_args.args
        expected = hmac.new(self.secret.encode(), headers["X-OCR-Timestamp"].encode() + b"." + body, hashlib.sha256).hexdigest()
        self.assertEqual(headers["X-OCR-Signature"], f"v1={expected}")
        self.assertEqual(json.loads(body)["id"], str(event.id))
        event.refresh_from_db()
        self.assertEqual(event.status, "delivered")
        deliver_event(str(event.id))
        deliver.assert_called_once()

    @override_settings(OCR_WEBHOOK_MAX_ATTEMPTS=2)
    @patch("product.ocr.tasks.deliver_webhook", return_value=503)
    def test_callback_backoff_is_bounded_with_stable_event(self, deliver):
        finish_job(self.job, "failed", error_code="model_outcome_unknown")
        event = self.job.webhook_event
        deliver_event(str(event.id))
        event.refresh_from_db()
        self.assertEqual(event.status, "pending")
        self.assertGreater(event.next_attempt_at, timezone.now())
        first_body = deliver.call_args.args[1]
        event.next_attempt_at = timezone.now() - timedelta(seconds=1)
        event.save()
        deliver_event(str(event.id))
        event.refresh_from_db()
        self.assertEqual(event.status, "failed")
        self.assertEqual(event.attempts, 2)
        self.assertEqual(deliver.call_args.args[1], first_body)
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "failed")

    @patch("product.ocr.tasks.deliver_event.apply_async")
    @patch("product.ocr.tasks.process_job.apply_async")
    def test_recovery_fails_expired_processing_and_releases_uploads(self, process, deliver):
        self.job.status = "processing"
        self.job.lease_token = uuid.uuid4()
        self.job.lease_expires_at = timezone.now() - timedelta(seconds=1)
        self.job.save()
        OCRUploadReservation.objects.create(organization=self.org, expires_at=timezone.now() - timedelta(seconds=1))
        recover_jobs()
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "failed")
        self.assertEqual(self.job.error_code, "model_outcome_unknown")
        self.assertFalse(OCRUploadReservation.objects.exists())
        process.assert_not_called()
        deliver.assert_called_once()

    @patch("product.ocr.tasks.deliver_event.apply_async")
    @patch("product.ocr.tasks.process_job.apply_async")
    def test_recovery_clears_expired_result_and_resumes_stale_webhook(self, process, deliver):
        finish_job(self.job, "succeeded", result={"text": "sensitive"})
        self.job.result_expires_at = timezone.now() - timedelta(seconds=1)
        self.job.save()
        event = self.job.webhook_event
        event.status = "sending"
        event.lease_expires_at = timezone.now() - timedelta(seconds=1)
        event.save()
        recover_jobs()
        self.job.refresh_from_db()
        event.refresh_from_db()
        self.assertEqual(self.job.status, "expired")
        self.assertIsNone(self.job.result)
        self.assertEqual(event.status, "pending")
        deliver.assert_called_once()

    @patch("product.ocr.tasks.process_job.apply_async", side_effect=ConnectionError())
    def test_broker_failure_preserves_queue_for_later_dispatch(self, dispatch):
        from product.ocr.tasks import dispatch_jobs
        dispatch_jobs()
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "queued")
        self.assertIsNotNone(self.job.dispatch_after)
        dispatch_jobs()
        dispatch.assert_called_once()

    def test_orphan_cleanup_deletes_only_old_unreferenced_files(self):
        import os
        import tempfile
        from pathlib import Path
        from product.ocr.tasks import cleanup_orphan_uploads
        with tempfile.TemporaryDirectory() as directory, override_settings(OCR_PRIVATE_ROOT=Path(directory)):
            old = Path(directory) / ("c" * 32)
            old.write_bytes(b"orphan")
            recent = Path(directory) / ("d" * 32)
            recent.write_bytes(b"recent")
            referenced = Path(directory) / self.job.storage_name
            referenced.write_bytes(b"kept")
            os.utime(old, (0, 0))
            os.utime(referenced, (0, 0))
            cleanup_orphan_uploads()
            self.delete_mock.assert_called_once_with(old.name)
