import hashlib
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import UserStatus
from apps.organizations.models import Organization, OrganizationMember
from product.ocr.models import OCRAPIKey, OCRJob, OCRUploadReservation
from product.ocr.services import create_api_key, reserve_upload


@override_settings(OCR_ENABLED=True, OCR_WEBHOOK_SIGNING_KEY="test-signing-master", ALLOWED_HOSTS=["testserver"],
                   RATE_LIMIT_MODE="off", RATE_LIMIT_BASELINE_MODE="off")
class OCRAPITests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.storage = override_settings(OCR_PRIVATE_ROOT=Path(self.directory.name))
        self.storage.enable()
        self.addCleanup(self.storage.disable)
        self.user = get_user_model().objects.create_user(
            email="developer@example.com", phone="+201000000001", password="test-password",
            status=UserStatus.ACTIVE, phone_verified_at=timezone.now(),
        )
        self.organization = Organization.objects.create(name="Developer", slug="developer")
        self.member = OrganizationMember.objects.create(organization=self.organization, user=self.user, role="OWNER")
        self.key, self.token, self.secret = create_api_key(self.organization, self.user, "Production")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.webhook = patch("product.ocr.serializers.validate_webhook_url", side_effect=lambda value: value)
        self.webhook.start()
        self.addCleanup(self.webhook.stop)
        self.dispatch = patch("product.ocr.tasks.dispatch_jobs.delay")
        self.dispatch.start()
        self.addCleanup(self.dispatch.stop)

    def submit(self, content=b"%PDF-1.7\ntest", idem="test-request", **extra):
        return self.client.post("/api/v1/ocr/jobs/", {
            "file": SimpleUploadedFile("document.pdf", content, content_type="application/pdf"),
            "webhook_url": "https://example.com/webhook", **extra,
        }, format="multipart", HTTP_IDEMPOTENCY_KEY=idem)

    def test_submit_returns_persisted_job_and_idempotent_replay(self):
        first = self.submit()
        self.assertEqual(first.status_code, 202, first.data)
        second = self.submit()
        self.assertEqual(second.status_code, 202, second.data)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(OCRJob.objects.count(), 1)
        self.assertEqual(len(list(Path(self.directory.name).iterdir())), 1)
        self.assertFalse(OCRUploadReservation.objects.exists())

    def test_idempotency_conflict_releases_reservation_and_extra_file(self):
        self.submit()
        response = self.submit(content=b"%PDF-different")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["error"]["code"], "ocr_idempotency_conflict")
        self.assertFalse(OCRUploadReservation.objects.exists())
        self.assertEqual(len(list(Path(self.directory.name).iterdir())), 1)

    def test_unknown_fields_and_invalid_documents_do_not_consume_quota(self):
        self.assertEqual(self.submit(extra="value").status_code, 400)
        self.assertEqual(self.submit(content=b"not a document").status_code, 400)
        self.assertFalse(OCRUploadReservation.objects.exists())
        self.assertFalse(OCRJob.objects.exists())

    @override_settings(OCR_MAX_PENDING_PER_ORG=1)
    def test_capacity_reserved_before_upload_parsing(self):
        reservation = reserve_upload(self.organization.id)
        with patch("product.ocr.views.store_upload") as store:
            self.assertEqual(self.submit().status_code, 429)
            store.assert_not_called()
        reservation.delete()
        self.assertEqual(self.submit().status_code, 202)

    def test_revoked_expired_demoted_and_ineligible_keys_rejected(self):
        self.key.revoked_at = timezone.now()
        self.key.save()
        self.assertEqual(self.submit().status_code, 401)
        self.key.revoked_at = None
        self.key.expires_at = timezone.now() - timedelta(seconds=1)
        self.key.save()
        self.assertEqual(self.submit().status_code, 401)
        self.key.expires_at = timezone.now() + timedelta(days=1)
        self.key.save()
        self.member.role = "MEMBER"
        self.member.save()
        self.assertEqual(self.submit().status_code, 401)
        self.member.role = "OWNER"
        self.member.save()
        self.user.status = UserStatus.BLOCKED
        self.user.save()
        self.assertEqual(self.submit().status_code, 401)

    def test_job_isolation_result_pending_and_expired(self):
        response = self.submit()
        job = OCRJob.objects.get(pk=response.data["id"])
        url = f"/api/v1/ocr/jobs/{job.id}/"
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.get(url + "result/").status_code, 409)
        job.status = "succeeded"
        job.result = {"text": "Hello"}
        job.result_expires_at = timezone.now() + timedelta(hours=1)
        job.save()
        self.assertEqual(self.client.get(url + "result/").data["result"], {"text": "Hello"})
        job.result_expires_at = timezone.now() - timedelta(seconds=1)
        job.save()
        self.assertEqual(self.client.get(url + "result/").status_code, 410)
        other = Organization.objects.create(name="Other", slug="other")
        OrganizationMember.objects.create(organization=other, user=self.user, role="ADMIN")
        _, token, _ = create_api_key(other, self.user, "Other")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get(url + "result/").status_code, 404)

    def test_key_management_only_returns_secrets_once(self):
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/v1/ocr/keys/", {"organization_id": str(self.organization.id), "name": "New"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        key = OCRAPIKey.objects.get(pk=response.data["id"])
        secret = response.data["api_key"].split(".")[1]
        self.assertEqual(key.secret_hash, hashlib.sha256(secret.encode()).hexdigest())
        self.assertNotIn("api_key", self.client.get("/api/v1/ocr/keys/").data[0])
        self.assertEqual(self.client.delete(f"/api/v1/ocr/keys/{key.id}/").status_code, 204)
        key.refresh_from_db()
        self.assertIsNotNone(key.revoked_at)

    def test_key_cannot_manage_keys_and_jwt_cannot_submit(self):
        self.assertEqual(self.client.get("/api/v1/ocr/keys/").status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer invalid-jwt")
        self.assertEqual(self.submit().status_code, 401)

    @override_settings(OCR_ENABLED=False)
    def test_disabled_ocr_rejects_submission(self):
        self.assertEqual(self.submit().status_code, 503)

    @override_settings(OCR_MAX_GLOBAL_PENDING=1)
    def test_global_capacity_includes_other_organization_upload(self):
        other = Organization.objects.create(name="Other", slug="other")
        reserve_upload(other.id)
        self.assertEqual(self.submit().status_code, 429)

    @override_settings(OCR_MAX_DAILY_BYTES=150000000)
    def test_daily_quota_reserves_worst_case_bytes(self):
        self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(self.submit(idem="another").status_code, 429)
        self.assertFalse(OCRUploadReservation.objects.exists())

    def test_org_and_creator_deletion_do_not_break_existing_account_workflows(self):
        self.assertEqual(self.submit().status_code, 202)
        self.user.delete()
        self.key.refresh_from_db()
        self.assertIsNone(self.key.created_by)
        self.assertEqual(self.submit().status_code, 401)
        self.organization.delete()
        self.assertFalse(OCRJob.objects.exists())
        self.assertFalse(OCRAPIKey.objects.exists())
