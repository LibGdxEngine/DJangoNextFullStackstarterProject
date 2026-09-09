import io
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from unittest.mock import MagicMock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject

from product.ocr.processing import DocumentValidationError, _scan_document, validate_document
from product.ocr import document_check
from product.ocr.uploads import private_path, store_upload


class DocumentValidationTests(SimpleTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        configuration = override_settings(
            OCR_PRIVATE_ROOT=Path(directory.name) / "private", MEDIA_ROOT=Path(directory.name) / "media",
            OCR_MAX_UPLOAD_BYTES=150_000_000, OCR_CLAMAV_HOST="scanner.invalid", OCR_CLAMAV_PORT=3310,
            OCR_SCAN_TIMEOUT=5, OCR_VALIDATION_TIMEOUT=10, OCR_VALIDATION_MEMORY_MB=512,
            OCR_MAX_IMAGE_PIXELS=100, OCR_MAX_PDF_PAGES=2,
        )
        configuration.enable()
        self.addCleanup(configuration.disable)

    def store(self, data, name="file.pdf"):
        result = store_upload(SimpleUploadedFile(name, data))
        return result["storage_name"], result["content_type"]

    def pdf(self, pages=1, active=False, encrypted=False):
        writer = PdfWriter()
        for _ in range(pages):
            writer.add_blank_page(width=72, height=72)
        if active:
            writer.add_js("app.alert('untrusted')")
        if encrypted:
            writer.encrypt("secret")
        output = io.BytesIO()
        writer.write(output)
        return output.getvalue()

    def image(self, format="PNG", size=(2, 2), animated=False):
        output = io.BytesIO()
        image = Image.new("RGB", size, "white")
        if animated:
            image.save(output, format=format, save_all=True, append_images=[Image.new("RGB", size)])
        else:
            image.save(output, format=format)
        return output.getvalue()

    def test_parser_constraints_deny_network_and_child_process_creation(self):
        script = (
            "import runpy, socket, os\n"
            "module = runpy.run_path(" + repr(document_check.__file__) + ")\n"
            "module['restrict_syscalls']()\n"
            "for operation in (socket.socket, os.fork):\n"
            "    try:\n"
            "        operation()\n"
            "    except PermissionError:\n"
            "        continue\n"
            "    raise RuntimeError('parser constraint failed')\n"
        )
        result = subprocess.run([sys.executable, "-I", "-c", script], env={}, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_parser_cannot_read_secrets_or_mutate_neighboring_files(self):
        stored = self.store(self.pdf())
        target = private_path(stored[0])
        original = target.read_bytes()
        script = (
            "import runpy, os\n"
            "module = runpy.run_path(" + repr(document_check.__file__) + ")\n"
            "target = " + repr(str(target)) + "\n"
            "module['restrict_syscalls']()\n"
            "operations = (lambda: open('/proc/self/environ', 'rb'),\n"
            "              lambda: open('/proc/' + str(os.getppid()) + '/environ', 'rb'),\n"
            "              lambda: open(target, 'rb'), lambda: os.unlink(target),\n"
            "              lambda: os.rename(target, target + '.moved'),\n"
            "              lambda: os.chmod(target, 0o777), lambda: os.kill(os.getppid(), 0))\n"
            "for operation in operations:\n"
            "    try:\n"
            "        operation()\n"
            "    except PermissionError:\n"
            "        continue\n"
            "    raise RuntimeError('parser boundary failed')\n"
        )
        result = subprocess.run([sys.executable, "-I", "-c", script], env={}, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_valid_pdf_png_jpeg_pass_real_constrained_subprocess(self):
        for name, data in [("a.pdf", self.pdf()), ("a.png", self.image()), ("a.jpeg", self.image("JPEG"))]:
            with self.subTest(name=name), patch("product.ocr.processing._scan_document"):
                validate_document(*self.store(data, name))

    def test_valid_image_variants_do_not_require_filesystem_access(self):
        for format, mode in [("PNG", "P"), ("PNG", "RGBA"), ("JPEG", "CMYK"), ("JPEG", "RGB")]:
            output = io.BytesIO()
            image = Image.new(mode, (2, 2))
            exif = Image.Exif()
            exif[270] = "OCR test document"
            image.save(output, format=format, exif=exif, progressive=True)
            extension = "png" if format == "PNG" else "jpg"
            with self.subTest(format=format, mode=mode), patch("product.ocr.processing._scan_document"):
                validate_document(*self.store(output.getvalue(), "variant." + extension))

    def test_malformed_active_encrypted_page_limit_bomb_and_animation_rejected(self):
        examples = [
            ("bad.pdf", b"%PDF-not a document"), ("active.pdf", self.pdf(active=True)),
            ("encrypted.pdf", self.pdf(encrypted=True)), ("pages.pdf", self.pdf(pages=3)),
            ("bomb.png", self.image(size=(20, 20))), ("animated.png", self.image(animated=True)),
            ("truncated.png", self.image()[:40]), ("truncated.jpg", self.image("JPEG")[:80]),
        ]
        for name, data in examples:
            with self.subTest(name=name), patch("product.ocr.processing._scan_document"):
                with self.assertRaises(DocumentValidationError):
                    validate_document(*self.store(data, name))

    def test_embedded_file_and_external_action_rejected(self):
        for embedded in (True, False):
            writer = PdfWriter()
            writer.add_blank_page(width=72, height=72)
            if embedded:
                writer.add_attachment("payload.txt", b"payload")
            else:
                writer.root_object[NameObject("/OpenAction")] = DictionaryObject({
                    NameObject("/S"): NameObject("/Launch"), NameObject("/F"): TextStringObject("/bin/sh"),
                })
            output = io.BytesIO()
            writer.write(output)
            with patch("product.ocr.processing._scan_document"), self.assertRaises(DocumentValidationError):
                validate_document(*self.store(output.getvalue()))

    def test_antivirus_unavailable_prevents_parser(self):
        stored = self.store(self.pdf())
        with patch("product.ocr.processing.socket.create_connection", side_effect=socket.timeout), \
                patch("product.ocr.processing.subprocess.run") as parser:
            with self.assertRaises(DocumentValidationError) as caught:
                validate_document(*stored)
        self.assertEqual(caught.exception.code, "scanner_unavailable")
        parser.assert_not_called()

    def test_scanner_requires_exact_clean_response(self):
        stored = self.store(self.pdf())
        for response, code in [(b"stream: Eicar FOUND\x00", "unsafe_document"),
                               (b"stream: size limit exceeded ERROR\x00", "scanner_unavailable"),
                               (b"", "scanner_unavailable"), (b"stream: OK\x00garbage", "scanner_unavailable")]:
            connection = MagicMock()
            connection.__enter__.return_value = connection
            connection.recv.return_value = response
            with self.subTest(response=response), patch("product.ocr.processing.socket.create_connection", return_value=connection):
                with self.assertRaises(DocumentValidationError) as caught:
                    _scan_document(private_path(stored[0]))
                self.assertEqual(caught.exception.code, code)

    def test_clean_scanner_streams_content_and_terminator(self):
        stored = self.store(self.pdf())
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.recv.side_effect = [b"stream: ", b"OK\x00"]
        with patch("product.ocr.processing.socket.create_connection", return_value=connection):
            _scan_document(private_path(stored[0]))
        self.assertEqual(connection.sendall.call_args_list[0].args[0], b"zINSTREAM\x00")
        self.assertEqual(connection.sendall.call_args_list[-1].args[0], b"\x00\x00\x00\x00")

    def test_parser_timeout_fails_closed_and_environment_is_empty(self):
        stored = self.store(self.pdf())
        with patch("product.ocr.processing._scan_document"), patch(
            "product.ocr.processing.subprocess.run", side_effect=subprocess.TimeoutExpired("parser", 10)
        ) as parser:
            with self.assertRaises(DocumentValidationError):
                validate_document(*stored)
        self.assertEqual(parser.call_args.kwargs["env"], {})
        self.assertFalse(parser.call_args.kwargs["shell"])
        self.assertTrue(parser.call_args.kwargs["close_fds"])
