"""OCR admission, private storage, and isolated task configuration."""

import os
from pathlib import Path

OCR_ENABLED = os.environ.get('OCR_ENABLED', 'false').lower() == 'true'
OCR_PRIVATE_ROOT = Path(os.environ.get('OCR_PRIVATE_ROOT', Path(__file__).resolve().parents[2] / 'private' / 'ocr'))
# Decimal MB, independent of browser Content-Length and multipart overhead.
OCR_MAX_UPLOAD_BYTES = 150_000_000
OCR_MAX_PENDING_PER_ORG = int(os.environ.get('OCR_MAX_PENDING_PER_ORG', '5'))
OCR_MAX_DAILY_BYTES = int(os.environ.get('OCR_MAX_DAILY_BYTES', '1500000000'))
OCR_MAX_STORED_BYTES = int(os.environ.get('OCR_MAX_STORED_BYTES', '1500000000'))
OCR_MAX_GLOBAL_PENDING = int(os.environ.get('OCR_MAX_GLOBAL_PENDING', '50'))
OCR_MAX_GLOBAL_STORED_BYTES = int(os.environ.get('OCR_MAX_GLOBAL_STORED_BYTES', '7500000000'))
OCR_API_KEY_TTL_DAYS = int(os.environ.get('OCR_API_KEY_TTL_DAYS', '90'))
OCR_WEBHOOK_SIGNING_KEY = os.environ.get('OCR_WEBHOOK_SIGNING_KEY', '')
OCR_WEBHOOK_MAX_ATTEMPTS = 8
OCR_JOB_LEASE_SECONDS = 1200
OCR_RESULT_RETENTION_HOURS = int(os.environ.get('OCR_RESULT_RETENTION_HOURS', '24'))
OCR_MODEL_URL = os.environ.get('OCR_MODEL_URL', '')
OCR_PROVIDER_KEY_ENCRYPTION_KEY = os.environ.get('OCR_PROVIDER_KEY_ENCRYPTION_KEY', '')
OCR_MODEL_FILE_FIELD = os.environ.get('OCR_MODEL_FILE_FIELD', 'file')
OCR_MODEL_TIMEOUT = 660
OCR_MAX_RESULT_BYTES = 20_000_000
OCR_CLAMAV_HOST = os.environ.get('OCR_CLAMAV_HOST', 'clamav')
OCR_CLAMAV_PORT = int(os.environ.get('OCR_CLAMAV_PORT', '3310'))
OCR_SCAN_TIMEOUT = 120
OCR_VALIDATION_TIMEOUT = 30
OCR_VALIDATION_MEMORY_MB = 512
OCR_MAX_IMAGE_PIXELS = 40_000_000
OCR_MAX_PDF_PAGES = 500
