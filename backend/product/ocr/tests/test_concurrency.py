"""Admission and task claims require real PostgreSQL row locks."""

import threading
from concurrent.futures import ThreadPoolExecutor
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from apps.accounts.models import UserStatus
from apps.organizations.models import Organization, OrganizationMember
from product.ocr.exceptions import OCRCapacityExceeded
from product.ocr.models import OCRJob, OCRUploadReservation
from product.ocr.services import accept_upload, create_api_key, reserve_upload
from product.ocr.tasks import process_job


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row-lock verification")
@override_settings(OCR_ENABLED=True, OCR_WEBHOOK_SIGNING_KEY="test-signing-master")
class OCRConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="concurrency@example.com", phone="+201000000005", password="test-password",
            status=UserStatus.ACTIVE, phone_verified_at=timezone.now(),
        )
        self.organization = Organization.objects.create(name="Concurrency", slug="concurrency")
        OrganizationMember.objects.create(organization=self.organization, user=self.user, role="OWNER")
        self.key, _, _ = create_api_key(self.organization, self.user, "Concurrency")

    def in_connection(self, barrier, action, *args):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return action(*args)
        finally:
            connections.close_all()

    @override_settings(OCR_MAX_GLOBAL_PENDING=1)
    def test_global_admission_allows_exactly_one_parallel_reservation(self):
        other = Organization.objects.create(name="Other", slug="other")
        barrier = threading.Barrier(2)

        def reserve(organization_id):
            try:
                reserve_upload(organization_id)
                return "accepted"
            except OCRCapacityExceeded:
                return "rejected"

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.in_connection, barrier, reserve, org_id)
                       for org_id in [self.organization.id, other.id]]
            results = [future.result(timeout=15) for future in futures]
        self.assertCountEqual(results, ["accepted", "rejected"])
        self.assertEqual(OCRUploadReservation.objects.count(), 1)

    def test_parallel_accept_with_same_idempotency_key_creates_one_job(self):
        reservations = [reserve_upload(self.organization.id), reserve_upload(self.organization.id)]
        barrier = threading.Barrier(2)

        def accept(reservation):
            try:
                job, created = accept_upload(self.key, reservation, "same-request", {
                    "storage_name": reservation.id.hex, "sha256": "a" * 64,
                    "size": 100, "content_type": "application/pdf",
                }, "https://example.com/webhook")
                return str(job.id), created
            finally:
                OCRUploadReservation.objects.filter(pk=reservation.pk).delete()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.in_connection, barrier, accept, reservation) for reservation in reservations]
            results = [future.result(timeout=15) for future in futures]
        self.assertEqual(results[0][0], results[1][0])
        self.assertCountEqual([result[1] for result in results], [True, False])
        self.assertEqual(OCRJob.objects.count(), 1)
        self.assertFalse(OCRUploadReservation.objects.exists())

    @patch("product.ocr.tasks.delete_upload")
    @patch("product.ocr.tasks.validate_document")
    def test_parallel_task_claims_invoke_gpu_once(self, validate, delete):
        job = OCRJob.objects.create(
            organization=self.organization, api_key=self.key, idempotency_key="request", fingerprint="a" * 64,
            storage_name="a" * 32, sha256="b" * 64, size=100, content_type="application/pdf",
            webhook_url="https://example.com/webhook",
        )
        barrier = threading.Barrier(2)
        model_entered = threading.Event()
        release_model = threading.Event()
        first_completed = threading.Event()

        def model(*args):
            model_entered.set()
            if not release_model.wait(timeout=10):
                raise TimeoutError("Test did not release model")
            return {"text": "result"}

        def process():
            process_job(str(job.id))
            first_completed.set()

        with patch("product.ocr.tasks.run_model", side_effect=model) as gpu, ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.in_connection, barrier, process) for _ in range(2)]
            try:
                self.assertTrue(model_entered.wait(timeout=10))
                self.assertTrue(first_completed.wait(timeout=10), "The duplicate claim should exit while GPU work runs")
            finally:
                release_model.set()
            for future in futures:
                future.result(timeout=15)
            gpu.assert_called_once()
        job.refresh_from_db()
        self.assertEqual(job.status, "succeeded")
        self.assertEqual(job.webhook_event.payload["data"]["status"], "succeeded")
