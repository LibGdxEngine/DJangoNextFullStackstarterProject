import logging

from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

BEAT_HEARTBEAT_CACHE_KEY = "celery:beat:heartbeat"
BEAT_HEARTBEAT_TTL = 300


@shared_task(name="apps.common.tasks.ping")
def ping():
    """Round-trip check that a worker is consuming the queue."""
    return "pong"


@shared_task(name="apps.common.tasks.beat_heartbeat")
def beat_heartbeat():
    """Refresh the marker that proves the beat scheduler is alive."""
    stamp = timezone.now().isoformat()
    cache.set(BEAT_HEARTBEAT_CACHE_KEY, stamp, timeout=BEAT_HEARTBEAT_TTL)
    return stamp
