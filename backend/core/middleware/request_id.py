import logging
import time

from opentelemetry import trace

from core.telemetry import record_http, request_id_context, valid_request_id

logger = logging.getLogger(__name__)


class RequestIdMiddleware:
    """Bind a validated request ID for logs, spans and published background tasks."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = valid_request_id(request.headers.get('X-Request-ID'))
        request.request_id = request_id
        token = request_id_context.set(request_id)
        trace.get_current_span().set_attribute('request.id', request_id)
        started = time.monotonic()
        status = 500
        try:
            response = self.get_response(request)
            status = response.status_code
            response['X-Request-ID'] = request_id
            return response
        finally:
            elapsed = time.monotonic() - started
            route = getattr(request.resolver_match, 'route', None) or 'unmatched'
            method = request.method if request.method in {'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'} else 'OTHER'
            record_http(method, route, status, elapsed)
            logger.info('HTTP request completed', extra={
                'http_method': method, 'http_route': route,
                'http_status': status, 'duration_seconds': elapsed,
            })
            request_id_context.reset(token)
