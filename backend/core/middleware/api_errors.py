"""Normalize API failures after Django has handled and logged exceptions."""

import json

from django.http import JsonResponse

from core.api_errors import normalize_error


class ApiErrorMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if not request.path_info.startswith("/api/") or response.status_code < 400:
            return response

        data = getattr(response, "data", None)
        if data is None and not response.streaming and response.get("Content-Type", "").startswith("application/json"):
            try:
                data = json.loads(response.content)
            except (ValueError, UnicodeDecodeError):
                pass
        body = normalize_error(data, response.status_code)
        replacement = JsonResponse(body, status=response.status_code)
        # Retain authentication, throttling, security, tracing headers and cookies.
        for key, value in response.items():
            if key.lower() not in {"content-type", "content-length", "content-encoding", "etag"}:
                replacement[key] = value
        replacement.cookies = response.cookies
        replacement.data = body
        return replacement
