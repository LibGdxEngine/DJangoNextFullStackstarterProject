import csv
import io
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from product.ocr.api_key_service import get_api_key
from product.ocr.management.commands.import_ocr_provider_keys import COLUMNS
from product.ocr.models import OCRProviderKey, OCRProviderKeyPoolLock
from product.ocr.tests.test_key_pool import ENCRYPTION_KEY, NOW


@override_settings(OCR_PROVIDER_KEY_ENCRYPTION_KEY=ENCRYPTION_KEY)
class OCRProviderKeyImportTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "synthetic.csv"

    def row(self, identifier=1, **changes):
        return {"id": str(identifier), "email": f"synthetic-{identifier}@example.test", "status": "success",
                "api_key": "synthetic-secret", "api_key_status": "active", "leased_by": "worker",
                "lease_expires_at": "2026-09-09T12:00:00+00:00", "created_at": "2026-01-01T10:00:00",
                "updated_at": "", "exhausted_at": "", **changes}

    def write(self, rows, columns=None):
        with self.path.open("w", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=columns or COLUMNS)
            writer.writeheader()
            writer.writerows(rows)

    def run_import(self, *args):
        output = io.StringIO()
        call_command("import_ocr_provider_keys", str(self.path), *args, stdout=output)
        return output.getvalue()

    def test_preserves_every_row_and_column_with_encrypted_credentials(self):
        self.write([self.row(), self.row(2, status="failed", api_key="", api_key_status="in_progress")])
        original_bytes = self.path.read_bytes()
        output = self.run_import()
        first = OCRProviderKey.objects.get(pk=1)
        self.assertEqual(first.email, "synthetic-1@example.test")
        self.assertEqual(first.status, "success")
        self.assertEqual(first.api_key, "synthetic-secret")
        self.assertNotIn("synthetic-secret", first.api_key_ciphertext)
        self.assertEqual(first.api_key_status, "active")
        self.assertEqual(first.leased_by, "worker")
        self.assertEqual(first.lease_expires_at, NOW)
        self.assertEqual(first.created_at.isoformat(), "2026-01-01T10:00:00+00:00")
        self.assertIsNone(first.updated_at)
        self.assertIsNone(first.exhausted_at)
        second = OCRProviderKey.objects.get(pk=2)
        self.assertEqual(second.status, "failed")
        self.assertEqual(second.api_key, "")
        self.assertEqual(second.api_key_status, "in_progress")
        self.assertEqual(self.path.read_bytes(), original_bytes)
        self.assertNotIn("synthetic-secret", output)
        self.assertNotIn("@example.test", output)

    def test_duplicate_credentials_remain_separate_source_rows(self):
        self.write([self.row(), self.row(2)])
        self.run_import()
        self.assertEqual(OCRProviderKey.objects.count(), 2)
        self.assertEqual(OCRProviderKey.objects.values("api_key_fingerprint").distinct().count(), 1)

    def test_identical_reimport_skips_without_resetting_exhaustion(self):
        self.write([self.row(), self.row(2, api_key="second")])
        self.run_import()
        get_api_key(exhausted="synthetic-secret", now=NOW)
        ciphertext = OCRProviderKey.objects.get(pk=1).api_key_ciphertext
        cursor_before = OCRProviderKeyPoolLock.objects.get(pk=1)
        output = self.run_import()
        key = OCRProviderKey.objects.get(pk=1)
        self.assertEqual(key.api_key_status, "exhausted")
        self.assertEqual(key.exhausted_at, NOW)
        self.assertEqual(key.api_key_ciphertext, ciphertext)
        cursor_after = OCRProviderKeyPoolLock.objects.get(pk=1)
        self.assertEqual(cursor_after.last_key_id, cursor_before.last_key_id)
        self.assertEqual(cursor_after.last_key_fingerprint, cursor_before.last_key_fingerprint)
        self.assertIn("skipped 2", output)

    def test_conflicting_existing_id_rolls_back_new_rows(self):
        self.write([self.row()])
        self.run_import()
        self.write([self.row(2), self.row(api_key="changed-secret")])
        with self.assertRaises(CommandError) as error:
            self.run_import()
        self.assertNotIn("changed-secret", str(error.exception))
        self.assertEqual(OCRProviderKey.objects.count(), 1)
        self.assertEqual(OCRProviderKey.objects.get(pk=1).api_key, "synthetic-secret")

    def test_dry_run_needs_no_encryption_key_and_writes_nothing(self):
        self.write([self.row(), self.row(2)])
        with override_settings(OCR_PROVIDER_KEY_ENCRYPTION_KEY=""), patch("product.ocr.management.commands.import_ocr_provider_keys.encrypt_api_key") as encrypt:
            output = self.run_import("--dry-run")
        self.assertIn("Validated 2 rows", output)
        encrypt.assert_not_called()
        self.assertFalse(OCRProviderKey.objects.exists())

    def test_invalid_timestamp_and_duplicate_id_have_safe_line_errors(self):
        self.write([self.row(updated_at="synthetic-secret-invalid-date")])
        with self.assertRaises(CommandError) as error:
            self.run_import()
        self.assertIn("line 2", str(error.exception))
        self.assertNotIn("synthetic-secret", str(error.exception))
        self.write([self.row(), self.row()])
        with self.assertRaises(CommandError) as error:
            self.run_import()
        self.assertIn("line 3", str(error.exception))
        self.assertFalse(OCRProviderKey.objects.exists())

    def test_invalid_late_row_rolls_back_earlier_bulk_batches(self):
        self.write([self.row(identifier) for identifier in range(1, 502)] + [self.row(502, exhausted_at="invalid")])
        with self.assertRaises(CommandError):
            self.run_import()
        self.assertFalse(OCRProviderKey.objects.exists())

    def test_unknown_header_is_rejected_without_echoing_it(self):
        self.path.write_text("id,private-secret-header\n1,value\n")
        with self.assertRaises(CommandError) as error:
            self.run_import()
        self.assertNotIn("private-secret-header", str(error.exception))

    def test_reads_standard_input_without_closing_it(self):
        self.write([self.row()])
        source = io.StringIO("\ufeff" + self.path.read_text())
        output = io.StringIO()
        with patch("product.ocr.management.commands.import_ocr_provider_keys.sys.stdin", source):
            call_command("import_ocr_provider_keys", "-", stdout=output)
        self.assertFalse(source.closed)
        self.assertEqual(OCRProviderKey.objects.count(), 1)
        self.assertIn("Imported 1 rows", output.getvalue())
