"""Bounded uploads into private quarantine; parsing happens in the worker."""

import hashlib
import os
from pathlib import Path
import re
import uuid

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadhandler import FileUploadHandler
from rest_framework.exceptions import APIException


class UploadRejected(APIException):
    status_code = 400
    default_code = "invalid_document"
    default_detail = "Upload a valid PDF, PNG, or JPEG document."


class UploadTooLarge(UploadRejected):
    status_code = 413
    default_code = "upload_too_large"
    default_detail = "The document exceeds the 150 MB upload limit."


def _extension(name):
    if not name or any(char in name for char in ("\x00", "/", "\\")):
        raise UploadRejected()
    extension = Path(name).suffix.lower()
    if extension not in {".pdf", ".png", ".jpg", ".jpeg"}:
        raise UploadRejected()
    return extension


class LimitedOCRUploadHandler(FileUploadHandler):
    """Install before TemporaryFileUploadHandler, before accessing request.data."""

    chunk_size = 64 * 1024

    def __init__(self, request=None):
        super().__init__(request)
        self.total = 0
        self.files = 0

    def new_file(self, *args, **kwargs):
        super().new_file(*args, **kwargs)
        self.files += 1
        if self.files != 1 or self.field_name != "file":
            raise UploadRejected("Exactly one document in the 'file' field is required.")
        _extension(self.file_name)

    def receive_data_chunk(self, raw_data, start):
        self.total += len(raw_data)
        if self.total > settings.OCR_MAX_UPLOAD_BYTES:
            raise UploadTooLarge()
        return raw_data

    def file_complete(self, file_size):
        if self.total == 0:
            raise UploadRejected("The document must not be empty.")
        return None


def _private_root():
    root = Path(settings.OCR_PRIVATE_ROOT)
    if root.is_symlink():
        raise ImproperlyConfigured("OCR_PRIVATE_ROOT must not be a symbolic link.")
    root = root.resolve()
    media_root = getattr(settings, "MEDIA_ROOT", None)
    if media_root and root.is_relative_to(Path(media_root).resolve()):
        raise ImproperlyConfigured("OCR_PRIVATE_ROOT must be outside MEDIA_ROOT.")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    return root


def private_path(storage_name):
    if not isinstance(storage_name, str) or not re.fullmatch(r"[0-9a-f]{32}", storage_name):
        raise UploadRejected()
    path = _private_root() / storage_name
    if path.is_symlink():
        raise UploadRejected()
    return path


def delete_upload(storage_name):
    private_path(storage_name).unlink(missing_ok=True)


def store_upload(upload):
    extension = _extension(upload.name)
    if upload.size is not None and upload.size > settings.OCR_MAX_UPLOAD_BYTES:
        raise UploadTooLarge()
    name = uuid.uuid4().hex
    path = private_path(name)
    digest = hashlib.sha256()
    size = 0
    signature = b""
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as destination:
            # read() bounds memory even for in-memory UploadedFile implementations.
            upload.seek(0)
            while chunk := upload.read(64 * 1024):
                size += len(chunk)
                if size > settings.OCR_MAX_UPLOAD_BYTES:
                    raise UploadTooLarge()
                signature = (signature + chunk[:8])[:8]
                digest.update(chunk)
                destination.write(chunk)
        if not size:
            raise UploadRejected("The document must not be empty.")
        if signature.startswith(b"%PDF-") and extension == ".pdf":
            content_type = "application/pdf"
        elif signature.startswith(b"\x89PNG\r\n\x1a\n") and extension == ".png":
            content_type = "image/png"
        elif signature.startswith(b"\xff\xd8\xff") and extension in {".jpg", ".jpeg"}:
            content_type = "image/jpeg"
        else:
            raise UploadRejected("The document content does not match an allowed file type.")
        return {"storage_name": name, "sha256": digest.hexdigest(), "size": size, "content_type": content_type}
    except BaseException:
        path.unlink(missing_ok=True)
        raise
