"""Fail-closed antivirus scanning followed by resource-limited document parsing."""

from pathlib import Path
import socket
import struct
import subprocess
import sys
import time

from django.conf import settings

from .uploads import UploadRejected, UploadTooLarge, private_path


class DocumentValidationError(UploadRejected):
    def __init__(self, code="invalid_document", detail="The document failed security validation."):
        self.code = code
        super().__init__(detail, code=code)


def _scan_document(path):
    deadline = time.monotonic() + settings.OCR_SCAN_TIMEOUT

    def remaining():
        timeout = deadline - time.monotonic()
        if timeout <= 0:
            raise TimeoutError()
        return timeout

    try:
        with socket.create_connection(
            (settings.OCR_CLAMAV_HOST, settings.OCR_CLAMAV_PORT), timeout=remaining()
        ) as connection:
            connection.settimeout(remaining())
            connection.sendall(b"zINSTREAM\x00")
            total = 0
            with path.open("rb") as document:
                while chunk := document.read(64 * 1024):
                    total += len(chunk)
                    if total > settings.OCR_MAX_UPLOAD_BYTES:
                        raise UploadTooLarge()
                    connection.settimeout(remaining())
                    connection.sendall(struct.pack("!I", len(chunk)) + chunk)
            if total == 0:
                raise DocumentValidationError()
            connection.settimeout(remaining())
            connection.sendall(b"\x00\x00\x00\x00")
            response = b""
            while b"\x00" not in response:
                connection.settimeout(remaining())
                chunk = connection.recv(1024)
                if not chunk or len(response) + len(chunk) > 4096:
                    raise OSError("Incomplete scanner response")
                response += chunk
        if response == b"stream: OK\x00":
            return
        if response.startswith(b"stream: ") and response.endswith(b" FOUND\x00"):
            raise DocumentValidationError("unsafe_document", "The document was rejected by the security scanner.")
        raise OSError("Scanner did not confirm the document is clean")
    except (OSError, TimeoutError):
        raise DocumentValidationError(
            "scanner_unavailable", "Document security scanning is temporarily unavailable."
        ) from None


def validate_document(storage_name, content_type):
    path = private_path(storage_name)
    if content_type not in {"application/pdf", "image/png", "image/jpeg"}:
        raise DocumentValidationError()
    _scan_document(path)
    try:
        result = subprocess.run(
            [
                sys.executable, "-I", str(Path(__file__).with_name("document_check.py")),
                str(path), content_type, str(settings.OCR_VALIDATION_TIMEOUT),
                str(settings.OCR_VALIDATION_MEMORY_MB), str(settings.OCR_MAX_IMAGE_PIXELS),
                str(settings.OCR_MAX_PDF_PAGES), str(settings.OCR_MAX_UPLOAD_BYTES),
            ],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={}, cwd="/", timeout=settings.OCR_VALIDATION_TIMEOUT,
            shell=False, close_fds=True, start_new_session=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise DocumentValidationError() from None
    if result.returncode != 0:
        raise DocumentValidationError()
