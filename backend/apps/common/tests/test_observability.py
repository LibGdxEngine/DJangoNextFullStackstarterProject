import json
import logging
import os
import subprocess
import sys
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase, TestCase
from django.utils.functional import SimpleLazyObject

from apps.accounts.models import User, UserStatus
from apps.common.health import dependency_status
from apps.common.observability import observability_auth
from apps.common.tasks import BEAT_HEARTBEAT_CACHE_KEY
from core.logging import JsonFormatter
from core.telemetry import (
    SafeSpanExporter, publish_context, request_id_context, safe_span,
    task_context, task_finished, task_started, valid_request_id,
)


class ObservabilityAuthorizationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_social_user('staff@example.test', is_staff=True, status=UserStatus.ACTIVE)
        self.url = '/internal/observability/auth/'

    def test_anonymous_redirect_is_fixed_and_headers_cannot_authenticate(self):
        response = self.client.get(self.url, {'next': 'https://attacker.test'}, HTTP_X_WEBAUTH_USER=str(self.user.pk))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/admin/login/?next=/observability/')
        self.assertIn('no-store', response['Cache-Control'])
        self.assertNotIn('X-WEBAUTH-USER', response)

    def test_staff_gets_database_identity_not_supplied_identity(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url, HTTP_X_WEBAUTH_USER='attacker')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-WEBAUTH-USER'], str(self.user.pk))
        self.assertIn('no-store', response['Cache-Control'])

    def test_nonstaff_and_nonactive_statuses_denied(self):
        self.client.force_login(self.user)
        for status, staff in [(UserStatus.ACTIVE, False), (UserStatus.PENDING, True), (UserStatus.BLOCKED, True), (UserStatus.DELETION_PENDING, True)]:
            with self.subTest(status=status, staff=staff):
                User.objects.filter(pk=self.user.pk).update(status=status, is_staff=staff)
                response = self.client.get(self.url)
                self.assertEqual(response.status_code, 403)
                self.assertNotIn('X-WEBAUTH-USER', response)

    def test_organization_admin_does_not_grant_platform_access(self):
        from apps.organizations.models import Organization, OrganizationMember
        organization = Organization.objects.create(name='Example', slug='example')
        OrganizationMember.objects.create(organization=organization, user=self.user, role=OrganizationMember.Role.ADMIN)
        self.user.is_staff = False
        self.user.save(update_fields=['is_staff'])
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_inactive_user_denied_and_session_logout_revokes_access(self):
        self.client.force_login(self.user)
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertNotEqual(self.client.get(self.url).status_code, 200)
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 302)

    def test_privilege_removal_applies_to_existing_session(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        User.objects.filter(pk=self.user.pk).update(is_staff=False)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_expired_session_cannot_authenticate(self):
        self.client.force_login(self.user)
        session = self.client.session
        session.set_expiry(-1)
        session.save()
        self.assertEqual(self.client.get(self.url).status_code, 302)

    def test_only_get_and_backend_failure_fails_closed(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.post(self.url).status_code, 405)
        request = RequestFactory().get(self.url)
        def fail():
            raise RuntimeError('sentinel-auth-secret')
        request.user = SimpleLazyObject(fail)
        response = observability_auth(request)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b'sentinel', response.content)
        self.assertIn('no-store', response['Cache-Control'])


class HealthTests(SimpleTestCase):
    def test_liveness_uses_no_dependency(self):
        with patch('apps.common.observability.dependency_status') as probe:
            response = self.client.get('/api/health/live/')
        self.assertEqual(response.status_code, 200)
        probe.assert_not_called()

    def test_readiness_down_is_503_and_has_no_exception_text(self):
        with patch('apps.common.observability.dependency_status', return_value={'database': 'down', 'redis': 'up'}):
            response = self.client.get('/api/health/ready/')
        self.assertEqual(response.status_code, 503)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertIn('error', response.json())

    def test_dependency_exceptions_are_not_returned(self):
        for backend in ('locmem.LocMemCache', 'redis.RedisCache'):
            configuration = {'default': {
                'BACKEND': f'django.core.cache.backends.{backend}',
                'LOCATION': 'redis://unused:6379/0',
            }}
            with self.subTest(backend=backend), self.settings(CACHES=configuration):
                with patch('apps.common.health.connection') as connection, patch('apps.common.health.cache') as cache_mock, patch('redis.Redis.from_url') as redis_probe:
                    connection.vendor = 'sqlite'
                    connection.cursor.side_effect = RuntimeError('sentinel-database-password')
                    cache_mock.set.side_effect = RuntimeError('sentinel-redis-password')
                    redis_probe.side_effect = RuntimeError('sentinel-redis-password')
                    self.assertEqual(dependency_status(), {'database': 'down', 'redis': 'down'})

    def test_status_does_not_publish_tasks(self):
        cache.set(BEAT_HEARTBEAT_CACHE_KEY, '2026-09-09T12:00:00+00:00')
        with patch('apps.common.health.dependency_status', return_value={'database': 'up', 'redis': 'up'}), patch('celery.app.task.Task.apply_async') as publish:
            response = self.client.get('/api/status/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['celery'], 'up')
        self.assertEqual(response.json()['beat']['status'], 'up')
        publish.assert_not_called()
        cache.delete(BEAT_HEARTBEAT_CACHE_KEY)

    def test_postgres_probe_has_connection_and_statement_deadlines(self):
        with patch('apps.common.health.connection') as connection, patch('psycopg.connect') as connect, patch('apps.common.health.cache'):
            connection.vendor = 'postgresql'
            connection.get_connection_params.return_value = {'dbname': 'test'}
            dependency_status()
        self.assertEqual(connect.call_args.kwargs['connect_timeout'], 2)
        self.assertEqual(connect.call_args.kwargs['options'], '-c statement_timeout=2000')


class TelemetryPrivacyTests(SimpleTestCase):
    def test_log_payloads_and_exception_details_are_removed(self):
        formatter = JsonFormatter()
        for name, message, args in [
            ('apps.messaging', 'Provider failed: %s', ('sentinel-secret',)),
            ('celery.app.trace', 'Task succeeded: sentinel-secret', ()),
            ('django.request', 'GET /?password=sentinel-secret', ()),
            ('httpx', 'https://sentinel-secret@example.test/?otp=123456', ()),
        ]:
            with self.subTest(logger=name):
                record = logging.LogRecord(name, logging.ERROR, __file__, 1, message, args, (ValueError, ValueError('sentinel-secret'), None))
                output = formatter.format(record)
                self.assertNotIn('sentinel-secret', output)
                self.assertEqual(json.loads(output)['exception_type'], 'ValueError')

    def test_exception_frames_preserve_location_without_source_or_locals(self):
        try:
            secret = 'sentinel-source-and-local-secret'
            raise ValueError(secret)
        except ValueError:
            record = logging.LogRecord('apps.test', logging.ERROR, __file__, 1, 'Operation failed', (), sys.exc_info())
        output = JsonFormatter().format(record)
        self.assertNotIn('sentinel', output)
        frame = json.loads(output)['exception_frames'][-1]
        self.assertEqual(frame['file'], 'test_observability.py')
        self.assertEqual(frame['function'], 'test_exception_frames_preserve_location_without_source_or_locals')
        self.assertIsInstance(frame['line'], int)

    def test_release_environment_fallback_is_included(self):
        record = logging.LogRecord('apps.test', logging.INFO, __file__, 1, 'Operation completed', (), None)
        with patch.dict(os.environ, {'OTEL_RESOURCE_ATTRIBUTES': '', 'OTEL_SERVICE_VERSION': 'release-123'}):
            self.assertEqual(json.loads(JsonFormatter().format(record))['release'], 'release-123')

    def test_spans_remove_sql_urls_task_arguments_and_exception_payloads(self):
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import ReadableSpan, Event
        from opentelemetry.trace import SpanContext, Status, StatusCode
        span = ReadableSpan(
            name='SELECT sentinel-secret', context=SpanContext(1, 2, False),
            resource=Resource({'service.name': 'test'}),
            attributes={'db.system': 'postgresql', 'db.statement': 'sentinel-secret', 'url.full': 'https://example.test/?secret=sentinel-secret', 'celery.args': 'sentinel-secret'},
            events=[Event('exception', attributes={'exception.message': 'sentinel-secret'})],
            status=Status(StatusCode.ERROR, 'sentinel-secret'),
        )
        cleaned = safe_span(span)
        self.assertEqual(cleaned.name, 'postgresql SELECT')
        self.assertEqual(cleaned.attributes, {'db.system': 'postgresql'})
        self.assertEqual(cleaned.events, ())
        self.assertIsNone(cleaned.status.description)
        exporter = MagicMock()
        SafeSpanExporter(exporter).export([span])
        self.assertNotIn('sentinel-secret', str(exporter.export.call_args))

    def test_request_context_propagates_and_clears_after_nested_tasks(self):
        request_id = str(uuid.uuid4())
        token = request_id_context.set(request_id)
        try:
            headers = {}
            publish_context(headers=headers)
            self.assertEqual(headers['x-request-id'], request_id)
            task = SimpleNamespace(name='test.task', request=SimpleNamespace(headers=headers))
            task_started(task_id='parent', task=task)
            task_started(task_id='child', task=task)
            task_finished(task=task, state='SUCCESS')
            self.assertEqual(task_context.get()['id'], 'parent')
            task_finished(task=task, state='FAILURE')
            self.assertIsNone(task_context.get())
            self.assertEqual(request_id_context.get(), request_id)
        finally:
            request_id_context.reset(token)
        self.assertEqual(request_id_context.get(), '')

    def test_invalid_request_ids_are_replaced(self):
        self.assertNotEqual(valid_request_id('sentinel-secret'), 'sentinel-secret')
        uuid.UUID(valid_request_id('anything'))

    def test_startup_failure_is_safe_and_not_retried(self):
        from core import telemetry
        with patch.dict(os.environ, {'OTEL_ENABLED': 'true'}), patch.object(telemetry, '_initialized_pid', None), patch.object(telemetry, '_initialize', side_effect=ValueError('sentinel-startup-secret')) as startup:
            with self.assertLogs('core.telemetry', level='ERROR') as records:
                telemetry.initialize()
                telemetry.initialize()
            self.assertEqual(startup.call_count, 1)
            self.assertNotIn('sentinel-startup-secret', JsonFormatter().format(records.records[0]))

    def test_invalid_sampling_ratios_use_environment_default(self):
        code = """
from core.telemetry import initialize, shutdown
from opentelemetry import trace
initialize()
assert 'TraceIdRatioBased{1.0}' in trace.get_tracer_provider().sampler.get_description()
shutdown()
"""
        for ratio in ('invalid', 'nan', 'inf', '-1', '1.1'):
            with self.subTest(ratio=ratio):
                result = subprocess.run(
                    [sys.executable, '-c', code],
                    cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
                    env={**os.environ, 'OTEL_ENABLED': 'true', 'OTEL_TRACES_SAMPLER_ARG': ratio,
                         'OTEL_EXPORTER_OTLP_ENDPOINT': 'http://127.0.0.1:1', 'DJANGO_SETTINGS_MODULE': 'core.settings.dev'},
                    capture_output=True, text=True, timeout=20,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_startup_is_idempotent_and_collector_outage_does_not_break_requests(self):
        # Providers are process-wide and cannot be reset safely by ordinary tests.
        code = '''
from core.telemetry import initialize, shutdown
from opentelemetry import trace
initialize()
provider = trace.get_tracer_provider()
initialize()
assert trace.get_tracer_provider() is provider
import django
django.setup()
from django.test import Client
assert Client().get('/api/hello/').status_code == 200
shutdown()
'''
        result = subprocess.run([sys.executable, '-c', code], cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))) , env={**os.environ, 'OTEL_ENABLED': 'true', 'OTEL_EXPORTER_OTLP_ENDPOINT': 'http://127.0.0.1:1', 'DJANGO_SETTINGS_MODULE': 'core.settings.dev'}, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
