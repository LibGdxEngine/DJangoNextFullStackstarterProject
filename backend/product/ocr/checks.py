"""Fail early when an enabled deployment cannot enforce the OCR trust boundary."""

from pathlib import Path

from django.conf import settings
from django.core.checks import Error, register


@register()
def check_ocr_configuration(app_configs, **kwargs):
    if not settings.OCR_ENABLED:
        return []
    errors = []
    from .credential_crypto import _cipher
    from django.core.exceptions import ImproperlyConfigured
    try:
        _cipher()
    except ImproperlyConfigured:
        errors.append(Error('Configure OCR_PROVIDER_KEY_ENCRYPTION_KEY before enabling OCR.', id='ocr.E007'))
    if len(settings.OCR_WEBHOOK_SIGNING_KEY.encode()) < 32:
        errors.append(Error('OCR_WEBHOOK_SIGNING_KEY must contain at least 32 bytes of independently generated secret material.', id='ocr.E001'))
    root = Path(settings.OCR_PRIVATE_ROOT)
    if not root.is_absolute() or any(
        root.resolve().is_relative_to(Path(directory).resolve())
        for directory in [getattr(settings, 'MEDIA_ROOT', None), getattr(settings, 'STATIC_ROOT', None)] if directory
    ):
        errors.append(Error('OCR_PRIVATE_ROOT must be an absolute private path outside MEDIA_ROOT and STATIC_ROOT.', id='ocr.E002'))
    if not settings.DEBUG and settings.DATABASES['default']['ENGINE'] != 'django.db.backends.postgresql':
        errors.append(Error('Enabled production OCR requires PostgreSQL row locks for atomic admission and job claims.', id='ocr.E003'))
    if settings.CELERY_BROKER_TRANSPORT_OPTIONS.get('visibility_timeout', 0) <= settings.OCR_JOB_LEASE_SECONDS:
        errors.append(Error('CELERY_VISIBILITY_TIMEOUT must exceed OCR_JOB_LEASE_SECONDS.', id='ocr.E004'))
    if any(getattr(settings, name) <= 0 for name in [
        'OCR_MAX_PENDING_PER_ORG', 'OCR_MAX_DAILY_BYTES', 'OCR_MAX_STORED_BYTES',
        'OCR_MAX_GLOBAL_PENDING', 'OCR_MAX_GLOBAL_STORED_BYTES', 'OCR_RESULT_RETENTION_HOURS',
    ]):
        errors.append(Error('OCR quotas and retention settings must be positive.', id='ocr.E005'))
    return errors
