"""Atomic, distributed admission. Redis is standalone; keys are never raw PII."""
import hashlib
import hmac
import json
import logging
import math
import time
import uuid
from functools import lru_cache

import redis
from django.conf import settings
from opentelemetry import metrics
from rest_framework.exceptions import APIException, Throttled

logger = logging.getLogger(__name__)


class RateLimitUnavailable(APIException):
    status_code = 503
    default_detail = 'Request protection is temporarily unavailable. Please try again shortly.'
    default_code = 'rate_limit_unavailable'
    wait = 5


# Check every independent bucket before debiting any. Denials never extend TTL.
# A bucket retains only admitted events in its longest configured rolling window.
ADMISSION_SCRIPT = '''
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local policies = cjson.decode(ARGV[1])
local wait = 0
local longest = {}
for i, key in ipairs(KEYS) do
    local maximum = 0
    for _, rule in ipairs(policies[i]) do maximum = math.max(maximum, rule[2] * 1000) end
    longest[i] = maximum
    redis.call('ZREMRANGEBYSCORE', key, '-inf', now - maximum)
    for _, rule in ipairs(policies[i]) do
        local cutoff = '(' .. tostring(now - rule[2] * 1000)
        local count = redis.call('ZCOUNT', key, cutoff, '+inf')
        if count >= rule[1] then
            local event = redis.call('ZRANGEBYSCORE', key, cutoff, '+inf', 'WITHSCORES', 'LIMIT', count - rule[1], 1)
            wait = math.max(wait, tonumber(event[2]) + rule[2] * 1000 - now)
        end
    end
end
if wait > 0 then return math.ceil(wait / 1000) end
for i, key in ipairs(KEYS) do
    redis.call('ZADD', key, now, ARGV[2])
    redis.call('PEXPIRE', key, longest[i])
end
return 0
'''


def record_outcome(policy, outcome, elapsed=None):
    # Only server-owned policy names and fixed outcomes enter telemetry.
    attributes = {'rate_limit.policy': policy, 'rate_limit.outcome': outcome}
    meter = metrics.get_meter('mobser')
    meter.create_counter('mobser.rate_limit.requests').add(1, attributes)
    if elapsed is not None:
        meter.create_histogram('mobser.rate_limit.duration', unit='s').record(elapsed, attributes)
    if outcome in {'limiter-error', 'fallback'}:
        logger.warning('Rate limit %s: %s', policy, outcome)


def key_for(policy, identity, *, mode=None):
    secret = settings.RATE_LIMIT_KEY_SECRET
    if not isinstance(secret, str) or not secret:
        raise RateLimitUnavailable()
    digest = hmac.new(secret.encode(), str(identity).encode(), hashlib.sha256).hexdigest()
    return f'{settings.RATE_LIMIT_KEY_PREFIX}{mode or settings.RATE_LIMIT_MODE}:{policy}:{digest}'


@lru_cache(maxsize=4)
def _redis_client(url, timeout):
    if not url.startswith(('redis://', 'rediss://', 'unix://')):
        raise ValueError('A real Redis URL is required')
    return redis.Redis.from_url(url, socket_connect_timeout=timeout, socket_timeout=timeout)


def get_redis_client():
    return _redis_client(settings.RATE_LIMIT_REDIS_URL, settings.RATE_LIMIT_REDIS_TIMEOUT)


def ensure_available():
    """Check before eligibility lookup where an outage must have uniform behavior."""
    if settings.RATE_LIMIT_MODE == 'off':
        return
    try:
        get_redis_client().ping()
    except (redis.RedisError, ValueError, TypeError, OSError):
        record_outcome('availability', 'limiter-error')
        raise RateLimitUnavailable() from None


def enforce_limits(items: list[tuple[str, str]]) -> None:
    mode = settings.RATE_LIMIT_MODE
    if mode == 'off' or not items:
        return
    started = time.monotonic()
    items = list(dict.fromkeys(items))
    policies = []
    keys = []
    try:
        if mode not in {'enforce', 'observe'}:
            raise ValueError('Invalid rate limit mode')
        for policy, identity in items:
            rules = settings.RATE_LIMITS[policy]
            if not rules or any(
                len(rule) != 2 or any(type(value) is not int or value <= 0 for value in rule)
                for rule in rules
            ):
                raise ValueError('Invalid rate policy')
            policies.append(rules)
            keys.append(key_for(policy, identity, mode=mode))
        wait = get_redis_client().eval(ADMISSION_SCRIPT, len(keys), *keys, json.dumps(policies), uuid.uuid4().hex)
        if type(wait) is not int or wait < 0:
            raise ValueError('Invalid Redis admission result')
    except (redis.RedisError, ValueError, KeyError, TypeError, OSError):
        for policy, _ in items:
            record_outcome(policy if policy in settings.RATE_LIMITS else 'configuration', 'limiter-error', time.monotonic() - started)
        raise RateLimitUnavailable() from None
    outcome = ('would-reject' if mode == 'observe' else 'reject') if wait else 'allow'
    for policy, _ in items:
        record_outcome(policy, outcome, time.monotonic() - started)
    if wait and mode == 'enforce':
        raise Throttled(wait=math.ceil(wait))


def normalize_identifier(value):
    if not isinstance(value, str):
        return ''
    value = value.strip()
    if '@' in value:
        return value.lower()
    from apps.accounts.phone import normalize_phone
    try:
        return normalize_phone(value)
    except ValueError:
        return value.lower()


def reserve_send(destination, channel):
    normalized = normalize_identifier(destination)
    # Channels come from trusted service code, not arbitrary request fields.
    if channel not in {'email', 'whatsapp'} or not normalized:
        raise ValueError('Invalid delivery destination or channel')
    enforce_limits([('send_recipient', f'{channel}:{normalized}')])
