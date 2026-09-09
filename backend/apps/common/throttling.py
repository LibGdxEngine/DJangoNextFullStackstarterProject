"""DRF adapters: approximate ordinary traffic and atomic sensitive admission."""
from django.conf import settings
from django.core.cache import caches
from rest_framework.throttling import BaseThrottle, SimpleRateThrottle

from .client_identity import get_client_ip
from .rate_limits import RateLimitUnavailable, enforce_limits, key_for, normalize_identifier, record_outcome


def _exempt(request, view):
    return request.method == 'OPTIONS' or request.method.lower() not in view.http_method_names or not hasattr(view, request.method.lower())


class BaselineThrottle(SimpleRateThrottle):
    """DRF rolling history is approximate under concurrency; never a spend cap."""
    rate = '60/min'
    policy = None

    def get_cache_key(self, request, view):
        identity = str(request.user.pk) if self.scope == 'user' else get_client_ip(request, strict=request.method not in {'GET', 'HEAD'})
        return key_for(f'baseline_{self.scope}', identity, mode=self.mode)

    def allow_request(self, request, view):
        self.mode = settings.RATE_LIMIT_BASELINE_MODE
        if self.mode == 'off' or _exempt(request, view):
            return True
        self.scope = self.policy or ('user' if request.user and request.user.is_authenticated else 'anonymous')
        try:
            if self.mode not in {'enforce', 'observe'}:
                raise ValueError('Invalid baseline mode')
            self.rate = settings.RATE_LIMIT_BASELINE_RATES[self.scope]
            self.num_requests, self.duration = self.parse_rate(self.rate)
            if self.num_requests <= 0:
                raise ValueError('Invalid rate')
            self.cache = caches[settings.RATE_LIMIT_CACHE_ALIAS]
            allowed = super().allow_request(request, view)
        except Exception:
            # Cache backends expose different connection/configuration exceptions.
            record_outcome(f'baseline_{self.scope}', 'limiter-error')
            if request.method in {'GET', 'HEAD'}:
                record_outcome(f'baseline_{self.scope}', 'fallback')
                return True
            raise RateLimitUnavailable() from None
        record_outcome(f'baseline_{self.scope}', 'allow' if allowed else 'would-reject' if self.mode == 'observe' else 'reject')
        return allowed or self.mode == 'observe'


class StatusThrottle(BaselineThrottle):
    policy = 'status'


OPERATIONS = {
    'login': ('login_ip', 'login_identifier'),
    'signup': ('signup_ip',),
    'forgot': ('forgot_ip', 'forgot_identifier'),
    'resend': ('resend_ip',),
    'confirm': ('confirm_ip', 'confirm_user'),
    'reset': ('reset_ip',),
    'refresh': ('refresh_ip',),
    'verify': ('verify_ip',),
    'social': ('social_ip',),
    'logout': ('logout_ip',),
    'profile_update': ('profile_update_user',),
    'sensitive': ('sensitive_ip', 'sensitive_user'),
}


class OperationThrottle(BaseThrottle):
    def allow_request(self, request, view):
        if settings.RATE_LIMIT_MODE == 'off' or _exempt(request, view):
            return True
        operation = getattr(view, 'rate_limit_operation', None)
        if isinstance(operation, dict):
            operation = operation.get(request.method)
        if not operation:
            return True
        policies = OPERATIONS[operation]
        # Provenance must pass even for user-only sensitive operations.
        ip = get_client_ip(request, strict=True)
        items = []
        for policy in policies:
            if policy.endswith('_ip'):
                items.append((policy, ip))
            elif policy.endswith('_user'):
                if request.user and request.user.is_authenticated:
                    items.append((policy, str(request.user.pk)))
            elif policy.endswith('_identifier'):
                data = request.data
                value = data.get('identifier', data.get('email', data.get('phone', ''))) if hasattr(data, 'get') else ''
                identifier = normalize_identifier(value)
                if identifier:
                    items.append((policy, identifier))
        enforce_limits(items)
        return True


class ExpensiveThrottle(BaseThrottle):
    """Compose with BaselineThrottle and IsAuthenticated on a future job endpoint."""
    def allow_request(self, request, view):
        if settings.RATE_LIMIT_MODE == 'off' or _exempt(request, view):
            return True
        get_client_ip(request, strict=True)
        if not request.user or not request.user.is_authenticated:
            from rest_framework.exceptions import NotAuthenticated
            raise NotAuthenticated()
        enforce_limits([('expensive_user', str(request.user.pk))])
        return True


class WebhookIngressThrottle(BaseThrottle):
    def allow_request(self, request, view):
        if settings.RATE_LIMIT_MODE == 'off' or _exempt(request, view):
            return True
        enforce_limits([('webhook_ingress', get_client_ip(request, strict=True))])
        return True
