"""Identity supplied by the private Caddy ingress contract, never arbitrary XFF."""
import hmac
import ipaddress

from django.conf import settings

from .rate_limits import RateLimitUnavailable, record_outcome


def _ip(value):
    try:
        if not isinstance(value, str) or '%' in value:
            return None
        address = ipaddress.ip_address(value)
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        return str(address)
    except ValueError:
        return None


def get_client_ip(request, *, strict=False):
    expected = settings.RATE_LIMIT_PROXY_TOKEN
    supplied = request.META.get('HTTP_X_MOBSER_PROXY_TOKEN', '')
    forwarded = _ip(request.META.get('HTTP_X_MOBSER_CLIENT_IP'))
    if settings.RATE_LIMIT_TRUST_PROXY and expected and isinstance(supplied, str):
        if hmac.compare_digest(expected.encode(), supplied.encode()) and forwarded:
            return forwarded
    relaxed = settings.RATE_LIMIT_ALLOW_DIRECT and not settings.RATE_LIMIT_PRODUCTION
    if strict and not relaxed:
        record_outcome('identity', 'limiter-error')
        raise RateLimitUnavailable()
    record_outcome('identity', 'fallback')
    peer = _ip(request.META.get('REMOTE_ADDR'))
    if peer:
        return peer
    if relaxed:
        return 'unknown-origin'
    raise RateLimitUnavailable()
