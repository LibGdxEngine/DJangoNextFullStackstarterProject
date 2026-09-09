"""JSON stdout logs; payloads and exception text never form part of the envelope."""

import json
import logging
import os
import re
import traceback
from datetime import datetime, timezone

from opentelemetry import trace

from core.telemetry import instance_id, request_id_context, task_context


class JsonFormatter(logging.Formatter):
    def format(self, record):
        resource = dict(part.split('=', 1) for part in os.environ.get('OTEL_RESOURCE_ATTRIBUTES', '').split(',') if '=' in part)
        span = trace.get_current_span().get_span_context()
        task = task_context.get() or {}
        # Third-party messages can contain unstructured SQL, task results, HTTP URLs
        # or exception text. Retain their event location/severity, never their data.
        message = record.msg if isinstance(record.msg, str) and record.name.startswith(('apps.', 'core.')) else f'{record.name}:{record.funcName}'
        if record.args:
            # Preserve the event template; dynamic values belong in reviewed fields.
            message = re.sub(r'%\([^)]+\)[#0 +\-\d.]*[sdrf]|%[#0 +\-\d.]*[sdrf]', '[redacted]', message)
        message = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[redacted]', message)
        message = re.sub(r'https?://\S+', '[url]', message)
        data = {
            'timestamp': datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            'severity': record.levelname, 'logger': record.name, 'message': message,
            'service': os.environ.get('OTEL_SERVICE_NAME', 'backend'),
            'environment': resource.get('deployment.environment.name', 'development'),
            'release': resource.get('service.version', os.environ.get('OTEL_SERVICE_VERSION', 'local')),
            'service_instance_id': instance_id(),
            'request_id': request_id_context.get() or getattr(getattr(record, 'request', None), 'request_id', ''),
            'trace_id': format(span.trace_id, '032x') if span.is_valid else '',
            'span_id': format(span.span_id, '016x') if span.is_valid else '',
            'task_id': task.get('id', ''), 'task_name': task.get('name', ''),
        }
        for key in ('http_method', 'http_route', 'http_status', 'duration_seconds'):
            if hasattr(record, key):
                data[key] = getattr(record, key)
        if record.exc_info and record.exc_info[0]:
            data['exception_type'] = record.exc_info[0].__name__
            data['exception_frames'] = [
                {'file': os.path.basename(frame.f_code.co_filename),
                 'function': frame.f_code.co_name, 'line': line}
                for frame, line in traceback.walk_tb(record.exc_info[2])
            ][-30:]
        return json.dumps(data, separators=(',', ':'))
