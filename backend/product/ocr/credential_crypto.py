"""Authenticated encryption for recoverable upstream credentials, never client keys."""

import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.views.decorators.debug import sensitive_variables


@sensitive_variables()
def _cipher():
    try:
        return Fernet(settings.OCR_PROVIDER_KEY_ENCRYPTION_KEY.encode('ascii'))
    except (ValueError, TypeError, UnicodeError, AttributeError):
        raise ImproperlyConfigured('Configure a valid OCR_PROVIDER_KEY_ENCRYPTION_KEY before accessing the provider key pool.') from None


@sensitive_variables()
def encrypt_api_key(plaintext):
    if not plaintext:
        return ''
    return _cipher().encrypt(plaintext.encode('utf-8')).decode('ascii')


@sensitive_variables()
def decrypt_api_key(ciphertext):
    if not ciphertext:
        return ''
    try:
        return _cipher().decrypt(ciphertext.encode('ascii')).decode('utf-8')
    except (InvalidToken, UnicodeError, ValueError):
        raise ImproperlyConfigured('The provider API key could not be decrypted with the configured encryption key.') from None


def fingerprint_api_key(plaintext):
    normalized = plaintext.strip()
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest() if normalized else ''
