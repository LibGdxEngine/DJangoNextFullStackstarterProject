import base64
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest import skipUnless

from django.db import close_old_connections, connection, connections
from django.test import TestCase, TransactionTestCase, override_settings

from product.ocr.api_key_service import NoUsableApiKey, get_api_key
from product.ocr.credential_crypto import encrypt_api_key, fingerprint_api_key
from product.ocr.models import OCRProviderKey, OCRProviderKeyPoolLock


ENCRYPTION_KEY = base64.urlsafe_b64encode(b"0" * 32).decode()
NOW = datetime(2026, 9, 9, 12, tzinfo=timezone.utc)


def create_key(identifier, plaintext, api_key_status="active", **kwargs):
    return OCRProviderKey.objects.create(
        id=identifier, email=f"synthetic-{identifier}@example.test", status="success",
        api_key_ciphertext=encrypt_api_key(plaintext), api_key_fingerprint=fingerprint_api_key(plaintext),
        api_key_status=api_key_status, **kwargs,
    )


@override_settings(OCR_PROVIDER_KEY_ENCRYPTION_KEY=ENCRYPTION_KEY)
class OCRProviderKeyPoolTests(TestCase):
    def test_advances_on_every_call_and_wraps_while_skipping_duplicate_credentials(self):
        create_key(1, "A")
        create_key(2, "B")
        create_key(3, "A")
        create_key(4, "C")
        self.assertEqual([get_api_key(now=NOW) for _ in range(4)], ["A", "B", "C", "A"])
        self.assertEqual(OCRProviderKeyPoolLock.objects.get(pk=1).last_key_id, 1)

    def test_reactivated_duplicate_cannot_repeat_previous_credential(self):
        early = create_key(1, "A", "exhausted", exhausted_at=NOW)
        create_key(2, "B")
        create_key(3, "A")
        self.assertEqual(get_api_key(now=NOW), "B")
        self.assertEqual(get_api_key(now=NOW), "A")
        early.exhausted_at = NOW - timedelta(days=30)
        early.save(update_fields=["exhausted_at"])
        self.assertEqual(get_api_key(now=NOW), "B")
        self.assertEqual(get_api_key(now=NOW), "A")

    def test_single_usable_credential_is_reused_after_each_cycle(self):
        create_key(1, "only")
        create_key(2, "only")
        self.assertEqual([get_api_key(now=NOW) for _ in range(3)], ["only", "only", "only"])

    def test_retired_credentials_are_skipped_during_rotation(self):
        create_key(1, "A")
        create_key(2, "retired", "exhausted", exhausted_at=NOW)
        create_key(3, "leased", "in_progress")
        create_key(4, "")
        create_key(5, "B")
        self.assertEqual([get_api_key(now=NOW) for _ in range(3)], ["A", "B", "A"])

    def test_failed_decryption_does_not_advance_cursor(self):
        from django.core.exceptions import ImproperlyConfigured
        create_key(1, "first")
        key = create_key(2, "second")
        self.assertEqual(get_api_key(now=NOW), "first")
        key.api_key_ciphertext = "invalid-ciphertext"
        key.save(update_fields=["api_key_ciphertext"])
        with self.assertRaises(ImproperlyConfigured):
            get_api_key(now=NOW)
        self.assertEqual(OCRProviderKeyPoolLock.objects.get(pk=1).last_key_id, 1)

    def test_skips_empty_and_in_progress_keys(self):
        create_key(1, "")
        create_key(2, "leased", "in_progress")
        create_key(3, "available")
        self.assertEqual(get_api_key(now=NOW), "available")

    def test_exhausts_every_duplicate_key_and_selects_next_id(self):
        create_key(1, "duplicate")
        create_key(2, "duplicate", "in_progress")
        create_key(3, "next")
        self.assertEqual(get_api_key(exhausted="duplicate", now=NOW), "next")
        self.assertEqual(OCRProviderKey.objects.filter(api_key_status="exhausted", exhausted_at=NOW).count(), 2)

    def test_last_key_exhaustion_is_persisted_when_pool_empty(self):
        key = create_key(1, "last")
        with self.assertRaises(NoUsableApiKey):
            get_api_key(exhausted="last", now=NOW)
        key.refresh_from_db()
        self.assertEqual(key.api_key_status, "exhausted")
        self.assertEqual(key.exhausted_at, NOW)

    def test_cooldown_boundary_and_legacy_updated_at_fallback(self):
        create_key(1, "recent", "exhausted", exhausted_at=NOW - timedelta(days=30) + timedelta(seconds=1))
        legacy = create_key(2, "legacy", "exhausted", updated_at=NOW - timedelta(days=30))
        self.assertEqual(get_api_key(now=NOW), "legacy")
        legacy.refresh_from_db()
        self.assertEqual(legacy.api_key_status, "active")
        self.assertIsNone(legacy.exhausted_at)
        self.assertEqual(legacy.updated_at, NOW - timedelta(days=30))

    def test_explicit_exhaustion_timestamp_takes_precedence_over_legacy(self):
        create_key(1, "recent", "exhausted", exhausted_at=NOW, updated_at=NOW - timedelta(days=90))
        with self.assertRaises(NoUsableApiKey):
            get_api_key(now=NOW)

    def test_reactivated_key_is_exhausted_again_before_selection(self):
        first = create_key(1, "first", "exhausted", exhausted_at=NOW - timedelta(days=31))
        create_key(2, "second")
        self.assertEqual(get_api_key(exhausted="first", now=NOW), "second")
        first.refresh_from_db()
        self.assertEqual(first.exhausted_at, NOW)
        self.assertEqual(first.api_key_status, "exhausted")

    def test_source_and_lease_metadata_are_unchanged_by_exhaustion(self):
        key = create_key(1, "first", created_at=NOW - timedelta(days=40), updated_at=NOW - timedelta(days=2),
                         leased_by="worker", lease_expires_at=NOW + timedelta(minutes=5), source_fingerprint="a" * 64)
        create_key(2, "second")
        get_api_key(exhausted="first", now=NOW)
        key.refresh_from_db()
        self.assertEqual(key.created_at, NOW - timedelta(days=40))
        self.assertEqual(key.updated_at, NOW - timedelta(days=2))
        self.assertEqual(key.leased_by, "worker")
        self.assertEqual(key.lease_expires_at, NOW + timedelta(minutes=5))
        self.assertEqual(key.source_fingerprint, "a" * 64)

    def test_padded_credential_and_status_follow_original_selection_rules(self):
        create_key(1, "  first  ", "  active  ")
        self.assertEqual(get_api_key(now=NOW), "first")

    def test_whitespace_exhausted_argument_does_not_retire_blank_rows(self):
        blank = create_key(1, "")
        create_key(2, "available")
        self.assertEqual(get_api_key(exhausted="  ", now=NOW), "available")
        blank.refresh_from_db()
        self.assertEqual(blank.api_key_status, "active")

    def test_selected_credential_is_decrypted_only_once(self):
        from unittest.mock import patch
        from product.ocr.credential_crypto import decrypt_api_key
        create_key(1, "first")
        create_key(2, "second")
        with patch("product.ocr.credential_crypto.decrypt_api_key", wraps=decrypt_api_key) as decrypt:
            self.assertEqual(get_api_key(now=NOW), "first")
        decrypt.assert_called_once()


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row-lock verification")
@override_settings(OCR_PROVIDER_KEY_ENCRYPTION_KEY=ENCRYPTION_KEY)
class OCRProviderKeyPoolConcurrencyTests(TransactionTestCase):
    def test_parallel_exhaustion_reuses_same_next_key_and_keeps_duplicate_rows_consistent(self):
        create_key(1, "first")
        create_key(2, "first")
        create_key(3, "next")
        barrier = threading.Barrier(2)

        def exhaust():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return get_api_key(exhausted="first", now=NOW)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(exhaust) for _ in range(2)]
            results = [future.result(timeout=15) for future in futures]
        self.assertEqual(results, ["next", "next"])
        self.assertEqual(OCRProviderKey.objects.filter(api_key_status="exhausted", exhausted_at=NOW).count(), 2)
        self.assertEqual(OCRProviderKey.objects.get(pk=3).api_key_status, "active")

    def test_parallel_calls_advance_to_different_credentials(self):
        create_key(1, "A")
        create_key(2, "B")
        create_key(3, "A")
        barrier = threading.Barrier(2)

        def choose():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return get_api_key(now=NOW)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(choose) for _ in range(2)]
            results = [future.result(timeout=15) for future in futures]
        self.assertCountEqual(results, ["A", "B"])
        self.assertEqual(OCRProviderKeyPoolLock.objects.get(pk=1).last_key_id, 2)
        self.assertEqual(get_api_key(now=NOW), "A")

    def test_cursor_survives_independent_database_connections(self):
        create_key(1, "A")
        create_key(2, "B")

        def choose():
            close_old_connections()
            try:
                return get_api_key(now=NOW)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            self.assertEqual(pool.submit(choose).result(timeout=15), "A")
            self.assertEqual(pool.submit(choose).result(timeout=15), "B")
        self.assertEqual(get_api_key(now=NOW), "A")
