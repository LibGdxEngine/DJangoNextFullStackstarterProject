import hashlib
import io
from pathlib import Path
import tempfile

from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.uploadhandler import TemporaryFileUploadHandler
from django.test import RequestFactory, SimpleTestCase, override_settings

from product.ocr.uploads import (
    LimitedOCRUploadHandler, UploadRejected, UploadTooLarge,
    delete_upload, private_path, store_upload,
)


class UploadTests(SimpleTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name) / "private"
        configuration = override_settings(
            OCR_PRIVATE_ROOT=self.root, OCR_MAX_UPLOAD_BYTES=32,
            MEDIA_ROOT=Path(directory.name) / "media",
        )
        configuration.enable()
        self.addCleanup(configuration.disable)

    def test_exact_boundary_uses_content_signature_and_private_generated_name(self):
        data = b"%PDF-" + b"x" * 27
        result = store_upload(SimpleUploadedFile("source.PDF", data, content_type="text/html"))
        self.assertEqual(result["size"], 32)
        self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(result["content_type"], "application/pdf")
        self.assertNotIn("source", result["storage_name"])
        path = private_path(result["storage_name"])
        self.assertEqual(path.read_bytes(), data)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o700)
        delete_upload(result["storage_name"])
        self.assertFalse(path.exists())
        delete_upload(result["storage_name"])

    def test_extension_spoof_unknown_signature_and_empty_are_rejected(self):
        for name, data in [("file.php", b"%PDF-123"), ("file.pdf", b"\x89PNG\r\n\x1a\n"),
                           ("file.png", b"<script>"), ("file.jpeg", b""), ("x.pdf.exe", b"%PDF-")]:
            with self.subTest(name=name), self.assertRaises(UploadRejected):
                store_upload(SimpleUploadedFile(name, data))
        self.assertEqual(list(self.root.iterdir()), [])

    def test_stream_size_enforced_when_client_size_is_false(self):
        upload = io.BytesIO(b"%PDF-" + b"x" * 28)
        upload.name = "document.pdf"
        upload.size = 1
        with self.assertRaises(UploadTooLarge):
            store_upload(upload)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_declared_oversize_is_rejected_before_storage(self):
        with self.assertRaises(UploadTooLarge):
            store_upload(SimpleUploadedFile("document.pdf", b"%PDF-" + b"x" * 28))
        self.assertFalse(self.root.exists())

    def test_original_path_and_storage_path_traversal_rejected(self):
        for name in ["../foo.pdf", "/tmp/foo.pdf", "a\\foo.pdf", "a\x00.pdf"]:
            with self.subTest(name=name), self.assertRaises(UploadRejected):
                upload = io.BytesIO(b"%PDF-")
                upload.name = name
                store_upload(upload)
        for name in ["../secret", "/etc/passwd", "a" * 31, "a" * 32 + ".pdf"]:
            with self.subTest(name=name), self.assertRaises(UploadRejected):
                private_path(name)

    def test_symlink_and_webroot_configuration_rejected(self):
        self.root.mkdir()
        target = self.root.parent / "secret"
        target.write_text("secret")
        (self.root / ("a" * 32)).symlink_to(target)
        with self.assertRaises(UploadRejected):
            private_path("a" * 32)
        with override_settings(OCR_PRIVATE_ROOT=self.root.parent / "media" / "ocr"):
            with self.assertRaises(ImproperlyConfigured):
                private_path("b" * 32)

    def test_handler_cumulative_limit_and_exact_boundary(self):
        handler = LimitedOCRUploadHandler()
        handler.new_file("file", "document.pdf", "application/pdf", 32)
        self.assertEqual(handler.receive_data_chunk(b"x" * 16, 0), b"x" * 16)
        handler.receive_data_chunk(b"x" * 16, 16)
        with self.assertRaises(UploadTooLarge):
            handler.receive_data_chunk(b"x", 32)

    def test_multipart_rejects_duplicate_files_and_unknown_file_field(self):
        for data in [
            {"file": [SimpleUploadedFile("a.pdf", b"%PDF-a"), SimpleUploadedFile("b.pdf", b"%PDF-b")]},
            {"other": SimpleUploadedFile("a.pdf", b"%PDF-a")},
        ]:
            request = RequestFactory().post("/", data)
            request.upload_handlers = [LimitedOCRUploadHandler(request), TemporaryFileUploadHandler(request)]
            with self.assertRaises(UploadRejected):
                _ = request.FILES
            request.close()

    def test_handler_writes_to_disk_and_rejects_empty(self):
        request = RequestFactory().post("/", {"file": SimpleUploadedFile("a.pdf", b"%PDF-a")})
        request.upload_handlers = [LimitedOCRUploadHandler(request), TemporaryFileUploadHandler(request)]
        self.assertTrue(hasattr(request.FILES["file"], "temporary_file_path"))
        request.close()
        handler = LimitedOCRUploadHandler()
        handler.new_file("file", "a.pdf", "application/pdf", 0)
        with self.assertRaises(UploadRejected):
            handler.file_complete(0)
