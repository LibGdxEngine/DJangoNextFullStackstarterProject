"""Persistent round-robin selection over distinct usable provider credentials."""

from datetime import timedelta, timezone as datetime_timezone

from django.db import connection, transaction
from django.db.models import F, Min, Q
from django.db.models.functions import Trim
from django.utils import timezone

from .credential_crypto import fingerprint_api_key
from .models import OCRProviderKey, OCRProviderKeyPoolLock


COOLDOWN_DAYS = 30


class NoUsableApiKey(RuntimeError):
    """No active credential remains in the provider pool."""


def lock_key_pool():
    """Caller must hold a transaction until its pool reads/writes are complete."""
    if connection.vendor == "sqlite":
        # SQLite ignores SELECT FOR UPDATE. Acquire its write lock before any
        # read, including the first-time singleton creation, to avoid stale reads.
        OCRProviderKeyPoolLock.objects.filter(pk=1).update(last_key_id=F("last_key_id"))
    OCRProviderKeyPoolLock.objects.get_or_create(pk=1)
    return OCRProviderKeyPoolLock.objects.select_for_update().get(pk=1)


def get_api_key(exhausted=None, *, now=None):
    """Advance to the next distinct active credential, wrapping after the last.

    A pool with one usable credential reuses it on each completed cycle.
    Explicitly exhausted credentials retain the existing 30-day cooldown.
    """
    now = now or timezone.now()
    if timezone.is_naive(now):
        now = now.replace(tzinfo=datetime_timezone.utc)
    cutoff = now - timedelta(days=COOLDOWN_DAYS)
    with transaction.atomic():
        cursor = lock_key_pool()
        pool = OCRProviderKey.objects.annotate(pool_status=Trim("api_key_status"))
        pool.filter(pool_status="exhausted").filter(
            Q(exhausted_at__lte=cutoff) | Q(exhausted_at__isnull=True, updated_at__lte=cutoff),
        ).update(api_key_status="active", exhausted_at=None)
        if exhausted and exhausted.strip():
            OCRProviderKey.objects.filter(api_key_fingerprint=fingerprint_api_key(exhausted)).update(
                api_key_status="exhausted", exhausted_at=now,
            )
        candidates = pool.filter(pool_status="active").exclude(
            api_key_fingerprint="",
        ).exclude(api_key_ciphertext="").values("api_key_fingerprint").annotate(
            key_id=Min("id"),
        ).order_by("key_id")
        # A duplicate row cooling down can move its credential's canonical ID.
        # Remember the fingerprint as well to avoid immediate reuse after a move.
        alternatives = candidates.exclude(api_key_fingerprint=cursor.last_key_fingerprint)
        selected = (alternatives.filter(key_id__gt=cursor.last_key_id).first()
                    or alternatives.first() or candidates.first())
        result = None
        if selected:
            credential = OCRProviderKey.objects.only("id", "api_key_ciphertext").get(pk=selected["key_id"])
            result = credential.api_key.strip()
            cursor.last_key_id = credential.id
            cursor.last_key_fingerprint = selected["api_key_fingerprint"]
            cursor.save(update_fields=["last_key_id", "last_key_fingerprint"])
    # Commit the final key's exhausted state even when no replacement exists.
    if result is None:
        raise NoUsableApiKey("No active provider API key is available.")
    return result
