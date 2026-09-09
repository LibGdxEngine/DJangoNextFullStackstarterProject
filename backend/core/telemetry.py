"""Process-local OpenTelemetry setup and a deliberately narrow export boundary."""

import atexit
import os
import socket
import time
import uuid
from contextvars import ContextVar

from opentelemetry import metrics, trace
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter
from opentelemetry.trace import Status

request_id_context = ContextVar('request_id', default='')
task_context = ContextVar('task', default=None)
_initialized_pid = None
_providers = []
_instance_pid = None
_instance_id = None

# Everything else (including SQL, URLs, request headers and exception messages) is
# excluded at the exporter boundary before anything leaves this process.
SAFE_ATTRIBUTES = frozenset({
    'http.method', 'http.request.method', 'http.status_code',
    'http.response.status_code', 'http.route', 'network.protocol.version',
    'db.system', 'db.system.name', 'db.operation', 'db.operation.name',
    'celery.action', 'celery.task_name', 'messaging.system',
    'messaging.operation', 'messaging.operation.type', 'messaging.message.id',
    'request.id', 'task.name', 'task.state', 'type', 'state', 'generation',
})


def instance_id():
    global _instance_pid, _instance_id
    if _instance_pid != os.getpid():
        _instance_pid = os.getpid()
        _instance_id = f'{socket.gethostname()}:{_instance_pid}:{uuid.uuid4()}'
    return _instance_id


def valid_request_id(value):
    # Accept UUIDs only: client-controlled correlation fields must not carry secrets.
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return str(uuid.uuid4())


def safe_span(span):
    attributes = {key: value for key, value in (span.attributes or {}).items() if key in SAFE_ATTRIBUTES}
    method = attributes.get('http.request.method', attributes.get('http.method'))
    if method:
        name = f'{method} {attributes.get("http.route", "HTTP")}'
    elif 'db.system' in attributes or 'db.system.name' in attributes:
        operation = attributes.get('db.operation.name', attributes.get('db.operation', ''))
        if not operation:
            operation = span.name.split(' ', 1)[0].upper()
        operation = operation if operation in {'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'SET', 'GET', 'PING', 'COMMIT', 'ROLLBACK', 'CONNECT'} else 'query'
        name = f'{attributes.get("db.system", attributes.get("db.system.name"))} {operation}'
    elif attributes.get('celery.task_name'):
        name = f'{attributes.get("celery.action", "task")} {attributes["celery.task_name"]}'
    else:
        # Unknown instrumentation may use a URL, SQL, or a payload as its span name.
        name = 'operation'
    return ReadableSpan(
        name=name, context=span.context, parent=span.parent, resource=span.resource,
        attributes=attributes, events=(), links=(), kind=span.kind,
        status=Status(span.status.status_code), start_time=span.start_time,
        end_time=span.end_time, instrumentation_scope=span.instrumentation_scope,
    )


class SafeSpanExporter(SpanExporter):
    def __init__(self, exporter):
        self.exporter = exporter

    def export(self, spans):
        return self.exporter.export(tuple(safe_span(span) for span in spans))

    def shutdown(self):
        self.exporter.shutdown()

    def force_flush(self, timeout_millis=30000):
        return self.exporter.force_flush(timeout_millis)


def initialize():
    """Call only in serving processes, after fork and before requests/tasks start."""
    global _initialized_pid
    if os.environ.get('OTEL_ENABLED', 'false').lower() != 'true' or _initialized_pid == os.getpid():
        return
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.celery import CeleryInstrumentor
    from opentelemetry.instrumentation.django import DjangoInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
    from opentelemetry.instrumentation.redis import RedisInstrumentor
    from opentelemetry.instrumentation.requests import RequestsInstrumentor
    from opentelemetry.instrumentation.system_metrics import SystemMetricsInstrumentor
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.metrics.view import View
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

    default_ratio = '0.1' if os.environ.get('DJANGO_SETTINGS_MODULE', '').endswith('.prod') else '1'
    ratio = float(os.environ.get('OTEL_TRACES_SAMPLER_ARG', default_ratio))
    resource = Resource.create({
        'service.name': os.environ.get('OTEL_SERVICE_NAME', 'backend'),
        'service.instance.id': instance_id(),
        'service.version': os.environ.get('OTEL_SERVICE_VERSION', 'local'),
    })
    tracer_provider = TracerProvider(resource=resource, sampler=ParentBased(TraceIdRatioBased(ratio)))
    tracer_provider.add_span_processor(BatchSpanProcessor(
        SafeSpanExporter(OTLPSpanExporter(timeout=2)),
        max_queue_size=2048, max_export_batch_size=256, schedule_delay_millis=5000,
        export_timeout_millis=3000,
    ))
    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[PeriodicExportingMetricReader(
            OTLPMetricExporter(timeout=2), export_interval_millis=15000, export_timeout_millis=3000,
        )],
        views=[View(instrument_name='*', attribute_keys=SAFE_ATTRIBUTES - {'request.id', 'messaging.message.id'})],
    )
    trace.set_tracer_provider(tracer_provider)
    metrics.set_meter_provider(meter_provider)
    _providers.extend([meter_provider, tracer_provider])
    # SDK startup happens before Django builds the middleware chain.
    DjangoInstrumentor().instrument(excluded_urls='health/live,health/ready,internal/observability/auth')
    CeleryInstrumentor().instrument()
    PsycopgInstrumentor().instrument(capture_parameters=False)
    RedisInstrumentor().instrument()
    RequestsInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()
    SystemMetricsInstrumentor(config={
        'process.cpu.time': ['user', 'system'],
        'process.memory.usage': None,
        'process.thread.count': None,
        'cpython.gc.collections': None,
    }).instrument()
    _initialized_pid = os.getpid()
    atexit.register(shutdown)


def shutdown(**kwargs):
    if _initialized_pid != os.getpid():
        return
    for provider in _providers[:]:
        provider.shutdown()
    _providers.clear()


def record_http(method, route, status, elapsed):
    meter = metrics.get_meter('mobser')
    attributes = {'http.request.method': method, 'http.route': route, 'http.response.status_code': status}
    meter.create_counter('mobser.http.requests').add(1, attributes)
    meter.create_histogram('mobser.http.duration', unit='s').record(elapsed, attributes)


def publish_context(headers=None, **kwargs):
    if headers is not None:
        headers['x-request-id'] = request_id_context.get()


def task_started(task_id=None, task=None, **kwargs):
    headers = getattr(task.request, 'headers', None) or {}
    token = request_id_context.set(valid_request_id(headers.get('x-request-id')))
    parent = task_context.get()
    task_context.set({'id': task_id, 'name': task.name, 'started': time.monotonic(), 'request_token': token, 'parent': parent})


def task_finished(task=None, state=None, **kwargs):
    context = task_context.get()
    if context is None:
        return
    try:
        meter = metrics.get_meter('mobser')
        attributes = {'task.name': task.name, 'task.state': state or 'UNKNOWN'}
        meter.create_counter('mobser.task.executions').add(1, attributes)
        meter.create_histogram('mobser.task.duration', unit='s').record(time.monotonic() - context['started'], attributes)
    finally:
        request_id_context.reset(context['request_token'])
        task_context.set(context['parent'])


def task_retried(sender=None, **kwargs):
    metrics.get_meter('mobser').create_counter('mobser.task.retries').add(1, {'task.name': sender.name})
