"""Adapter for a server-configured synchronous multipart OCR model endpoint."""

import json
import time
from urllib.parse import urlsplit

import httpx
from django.conf import settings

from .uploads import private_path


class ModelError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def run_model(storage_name, content_type, job_id):
    url = settings.OCR_MODEL_URL
    try:
        parts = urlsplit(url)
        if not parts.hostname or parts.scheme != 'https' or parts.username or parts.password or parts.fragment:
            raise ValueError
        parts.port  # Validate before opening the source file.
    except ValueError as exc:
        raise ModelError('model_not_configured') from exc
    token = settings.OCR_MODEL_TOKEN
    headers = {'Accept': 'application/json', 'Accept-Encoding': 'identity', 'Idempotency-Key': str(job_id)}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    extension = {'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg'}[content_type]
    deadline = time.monotonic() + settings.OCR_MODEL_TIMEOUT
    try:
        # httpx streams seekable file objects as multipart instead of buffering
        # the entire 150 MB input. Never use requests' buffered files= path here.
        with private_path(storage_name).open('rb') as source, httpx.Client(
            trust_env=False, follow_redirects=False,
            timeout=httpx.Timeout(settings.OCR_MODEL_TIMEOUT, connect=10, write=120, pool=10),
        ) as client:
            with client.stream(
                'POST', url, headers=headers,
                files={settings.OCR_MODEL_FILE_FIELD: (f'{job_id}.{extension}', source, content_type)},
            ) as response:
                if response.status_code != 200:
                    raise ModelError('model_response_error')
                if response.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
                    raise ModelError('model_invalid_response')
                if response.headers.get('content-encoding', 'identity').lower() != 'identity':
                    raise ModelError('model_invalid_response')
                result = bytearray()
                for chunk in response.iter_raw(chunk_size=64 * 1024):
                    if time.monotonic() > deadline:
                        raise ModelError('model_outcome_unknown')
                    if len(result) + len(chunk) > settings.OCR_MAX_RESULT_BYTES:
                        raise ModelError('model_result_too_large')
                    result.extend(chunk)
                try:
                    data = json.loads(result, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
                except (ValueError, UnicodeDecodeError, RecursionError) as exc:
                    raise ModelError('model_invalid_response') from exc
                if not isinstance(data, (dict, list)):
                    raise ModelError('model_invalid_response')
                return data
    except ModelError:
        raise
    except (httpx.TransportError, OSError) as exc:
        # The model may have accepted work before the connection disappeared.
        # Only an upstream idempotency/reconciliation contract permits a retry.
        raise ModelError('model_outcome_unknown') from exc
