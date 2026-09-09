"""Offline deployment checks: no secrets or services needed to import the schema."""
import math

from django.conf import settings
from django.core.checks import Error, register
from rest_framework.throttling import SimpleRateThrottle


@register()
def check_rate_limit_configuration(app_configs, **kwargs):
    errors = []
    if settings.RATE_LIMIT_MODE not in {'off', 'observe', 'enforce'}:
        errors.append(Error('Invalid RATE_LIMIT_MODE.', id='rate_limits.E001'))
    if settings.RATE_LIMIT_BASELINE_MODE not in {'off', 'observe', 'enforce'}:
        errors.append(Error('Invalid RATE_LIMIT_BASELINE_MODE.', id='rate_limits.E002'))
    for name, rules in settings.RATE_LIMITS.items():
        try:
            valid = rules and all(len(rule) == 2 and all(type(n) is int and n > 0 for n in rule) for rule in rules)
        except TypeError:
            valid = False
        if not valid:
            errors.append(Error(f'Invalid rate policy: {name}.', id='rate_limits.E003'))
    for scope in ('anonymous', 'user', 'status'):
        try:
            rate = settings.RATE_LIMIT_BASELINE_RATES[scope]
            if not isinstance(rate, str):
                raise ValueError
            count, duration = SimpleRateThrottle.parse_rate(None, rate)
            if count <= 0 or duration <= 0:
                raise ValueError
        except (KeyError, ValueError, TypeError, IndexError):
            errors.append(Error(f'Invalid baseline rate: {scope}.', id='rate_limits.E011'))
    timeout = settings.RATE_LIMIT_REDIS_TIMEOUT
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        errors.append(Error('RATE_LIMIT_REDIS_TIMEOUT must be finite and positive.', id='rate_limits.E012'))
    if not settings.RATE_LIMIT_PRODUCTION:
        return errors
    if settings.RATE_LIMIT_MODE != 'enforce':
        errors.append(Error('Production security policies must be enforced.', id='rate_limits.E004'))
    if not settings.RATE_LIMIT_TRUST_PROXY or settings.RATE_LIMIT_ALLOW_DIRECT:
        errors.append(Error('Production requires trusted proxy identity and forbids direct mode.', id='rate_limits.E005'))
    for name in ('RATE_LIMIT_KEY_SECRET', 'RATE_LIMIT_PROXY_TOKEN'):
        value = getattr(settings, name, '')
        if len(value) < 32 or value.lower().startswith(('dev', 'django-insecure')):
            errors.append(Error(f'{name} must be a dedicated strong production secret.', id='rate_limits.E006'))
    if not settings.RATE_LIMIT_REDIS_URL.startswith(('redis://', 'rediss://', 'unix://')):
        errors.append(Error('Production admission requires a real Redis URL.', id='rate_limits.E007'))
    backend = settings.CACHES.get(settings.RATE_LIMIT_CACHE_ALIAS, {}).get('BACKEND', '')
    if 'redis' not in backend.lower():
        errors.append(Error('Production baseline throttles require a Redis cache.', id='rate_limits.E008'))
    if settings.RATE_LIMIT_BASELINE_MODE == 'off':
        errors.append(Error('Production baseline limits must be enforced or observed.', id='rate_limits.E009'))
    from apps.integrations.hireagents.webhooks import check_webhook_credentials
    errors.extend(check_webhook_credentials(app_configs, **kwargs))
    return errors
