"""The public error contract shared by DRF and Django API responses."""

from collections.abc import Mapping

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


STATUS_ERRORS = {
    400: ("bad_request", "The request could not be processed."),
    401: ("not_authenticated", "Authentication is required."),
    403: ("permission_denied", "You do not have permission to perform this action."),
    404: ("not_found", "The requested resource was not found."),
    405: ("method_not_allowed", "This request method is not allowed."),
    406: ("not_acceptable", "The requested response format is not available."),
    415: ("unsupported_media_type", "The request content type is not supported."),
    429: ("throttled", "Too many requests. Please try again later."),
}


def flatten_errors(value, path=""):
    """Keep message lists intact while flattening nested serializer field paths."""
    fields = {}
    if isinstance(value, Mapping):
        for key, child in value.items():
            key = "non_field_errors" if key == "__all__" else key
            fields.update(flatten_errors(child, f"{path}.{key}" if path else str(key)))
    elif isinstance(value, (list, tuple)):
        if all(not isinstance(item, (Mapping, list, tuple)) for item in value):
            if value:
                fields[path or "non_field_errors"] = [str(item) for item in value]
        else:
            for index, child in enumerate(value):
                fields.update(flatten_errors(child, f"{path}.{index}" if path else str(index)))
    else:
        fields[path or "non_field_errors"] = [str(value)]
    return fields


def error_body(code, message, *, fields=None, context=None):
    error = {"code": str(code), "message": str(message), "fields": fields or {}}
    if context:
        error["context"] = context
    return {"error": error}


def error_response(code, message, *, status=400, fields=None, context=None):
    return Response(error_body(code, message, fields=fields, context=context), status=status)


def validation_error_response(exc):
    detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
    return error_response(
        "validation_error", "Please correct the highlighted fields.", fields=flatten_errors(detail)
    )


def normalize_error(data, status_code, *, code=None, validation=False):
    default_code, message = STATUS_ERRORS.get(
        status_code, ("internal_error", "An unexpected error occurred.")
        if status_code >= 500 else ("request_error", "The request failed.")
    )
    if isinstance(data, Mapping) and isinstance(data.get("error"), Mapping):
        error = data["error"]
        if (
            isinstance(error.get("code"), str)
            and isinstance(error.get("message"), str)
            and isinstance(error.get("fields"), Mapping)
            and all(
                isinstance(messages, list) and all(isinstance(item, str) for item in messages)
                for messages in error["fields"].values()
            )
            and ("context" not in error or isinstance(error["context"], Mapping))
        ):
            return data
    if validation:
        return error_body("validation_error", "Please correct the highlighted fields.", fields=flatten_errors(data))
    fields = {}
    context = None
    if isinstance(data, Mapping):
        code = data.get("code") or code
        detail = data.get("detail") or data.get("message") or data.get("error")
        if isinstance(detail, str):
            message = detail
        elif detail is not None:
            fields = flatten_errors(detail)
        elif data:
            fields = flatten_errors(data)
        context = {key: value for key, value in data.items() if key in {"email", "phone"}}
    elif isinstance(data, (list, tuple)):
        fields = flatten_errors(data)
    return error_body(code or default_code, message, fields=fields, context=context)


def exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
    # DRF handles transaction rollback and authentication/throttling headers here.
    response = drf_exception_handler(exc, context)
    if response is None:
        # Django must report unexpected exceptions before the response fallback runs.
        return None
    codes = exc.get_codes() if hasattr(exc, "get_codes") else None
    response.data = normalize_error(
        response.data, response.status_code,
        code=codes if isinstance(codes, str) else None,
        validation=isinstance(exc, ValidationError),
    )
    if response.status_code in (429, 503) and response.get('Retry-After', '').isdigit():
        response.data['error'].setdefault('context', {})['retry_after_seconds'] = int(response['Retry-After'])
    return response
