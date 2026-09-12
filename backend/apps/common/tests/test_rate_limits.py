import concurrent.futures
import os
import time
import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import redis
from django.apps import apps
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings, tag
from rest_framework.exceptions import Throttled
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from apps.common.checks import check_rate_limit_configuration
from apps.common.rate_limits import (
    RateLimitUnavailable, enforce_limits, get_redis_client, key_for,
    normalize_identifier, reserve_send,
)
from apps.common.throttling import BaselineThrottle, ExpensiveThrottle, OperationThrottle


class RatePolicyTests(SimpleTestCase):
    def test_identifiers_match_existing_lookup_normalization(self):
        self.assertEqual(normalize_identifier(' User@Example.COM '), 'user@example.com')
        self.assertEqual(normalize_identifier('01039811349'), '+201039811349')
        self.assertEqual(normalize_identifier(None), '')
        self.assertEqual(normalize_identifier({'email': 'not a string'}), '')

    @override_settings(RATE_LIMIT_MODE='enforce', RATE_LIMIT_KEY_SECRET='test-secret', RATE_LIMIT_KEY_PREFIX='test:')
    def test_keys_are_bounded_and_contain_no_identifiers(self):
        key = key_for('login_identifier', 'user@example.com')
        self.assertNotIn('user@example.com', key)
        self.assertLess(len(key), 120)
        self.assertNotEqual(key, key_for('login_identifier', 'other@example.com'))
        self.assertNotEqual(key, key_for('login_identifier', 'user@example.com', mode='observe'))

    @override_settings(RATE_LIMIT_MODE='enforce')
    @patch('apps.common.rate_limits.get_redis_client', side_effect=redis.ConnectionError('private host'))
    def test_strict_outage_is_sanitized_503(self, client):
        with self.assertRaises(RateLimitUnavailable) as caught:
            enforce_limits([('login_ip', '127.0.0.1')])
        self.assertEqual(caught.exception.status_code, 503)
        self.assertNotIn('private host', str(caught.exception))
        self.assertEqual(caught.exception.wait, 5)

    @override_settings(RATE_LIMIT_MODE='enforce')
    @patch('apps.common.rate_limits.get_redis_client')
    def test_script_invalid_response_fails_closed(self, client):
        client.return_value.eval.return_value = None
        with self.assertRaises(RateLimitUnavailable):
            enforce_limits([('login_ip', '127.0.0.1')])

    @override_settings(RATE_LIMIT_PRODUCTION=True, RATE_LIMIT_MODE='off', RATE_LIMIT_ALLOW_DIRECT=True,
                       RATE_LIMIT_TRUST_PROXY=False, RATE_LIMIT_KEY_SECRET='dev-key', RATE_LIMIT_PROXY_TOKEN='',
                       RATE_LIMIT_REDIS_URL='locmem://', RATE_LIMIT_BASELINE_MODE='off',
                       CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
    def test_production_configuration_cannot_disable_security(self):
        codes = {error.id for error in check_rate_limit_configuration(None)}
        self.assertTrue({'rate_limits.E004', 'rate_limits.E005', 'rate_limits.E006',
                         'rate_limits.E007', 'rate_limits.E008', 'rate_limits.E009'} <= codes)

    def test_invalid_baseline_rates_and_timeouts_are_rejected_offline(self):
        for rates in ({}, {'anonymous': '0/min', 'user': 'bad', 'status': None},
                      {'anonymous': '1/', 'user': '-1/hour', 'status': '5/15min'}):
            with override_settings(RATE_LIMIT_BASELINE_RATES=rates):
                errors = check_rate_limit_configuration(None)
                self.assertEqual(sum(error.id == 'rate_limits.E011' for error in errors), 3)
        for timeout in (0, -1, float('inf'), float('nan'), True, '0.3'):
            with override_settings(RATE_LIMIT_REDIS_TIMEOUT=timeout):
                self.assertIn('rate_limits.E012', {error.id for error in check_rate_limit_configuration(None)})

    @override_settings(
        RATE_LIMIT_PRODUCTION=True, RATE_LIMIT_MODE='enforce', RATE_LIMIT_BASELINE_MODE='observe',
        RATE_LIMIT_ALLOW_DIRECT=False, RATE_LIMIT_TRUST_PROXY=True,
        RATE_LIMIT_KEY_SECRET='production-test-key-secret-thirty-two-characters',
        RATE_LIMIT_PROXY_TOKEN='production-test-proxy-token-thirty-two-characters',
        RATE_LIMIT_REDIS_URL='redis://not-contacted:6379/1',
        CACHES={'default': {'BACKEND': 'django.core.cache.backends.redis.RedisCache',
                            'LOCATION': 'redis://not-contacted:6379/1'}},
        HIREAGENTS_CONNECTIONS={'auth': {'webhook_api_key': 'configured-production-webhook-key'}},
    )
    @patch('apps.common.rate_limits.get_redis_client')
    def test_valid_production_startup_is_offline_and_invalid_webhooks_stop_startup(self, redis_client):
        self.assertEqual(check_rate_limit_configuration(None), [])
        apps.get_app_config('common').ready()
        redis_client.assert_not_called()
        for key in ('', 'dev-hireagents-auth-webhook-key'):
            with override_settings(HIREAGENTS_CONNECTIONS={'auth': {'webhook_api_key': key}}):
                with self.assertRaises(ImproperlyConfigured):
                    apps.get_app_config('common').ready()

    @patch('apps.common.rate_limits.enforce_limits')
    def test_shared_recipient_normalization(self, enforce):
        reserve_send(' USER@Example.COM ', 'email')
        enforce.assert_called_once_with([('send_recipient', 'email:user@example.com')])


class TestLoginView(APIView):
    authentication_classes = []
    throttle_classes = [OperationThrottle]
    rate_limit_operation = 'login'

    def post(self, request):
        return Response({'ok': True})


class TestExpensiveView(APIView):
    authentication_classes = []
    throttle_classes = [ExpensiveThrottle]
    work = Mock()

    def post(self, request):
        self.work()
        return Response({'ok': True})


class TestOrdinaryView(APIView):
    authentication_classes = []
    throttle_classes = [BaselineThrottle]

    def get(self, request):
        return Response({'ok': True})

    def post(self, request):
        return Response({'ok': True})


@override_settings(RATE_LIMIT_MODE='enforce', RATE_LIMIT_ALLOW_DIRECT=True,
                   RATE_LIMIT_PRODUCTION=False, RATE_LIMIT_TRUST_PROXY=False)
class ThrottleAdapterTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    @patch('apps.common.throttling.enforce_limits')
    def test_public_login_charges_ip_even_when_authenticated(self, enforce):
        request = self.factory.post('/', {'identifier': ' U@Example.com '}, format='json')
        force_authenticate(request, user=SimpleNamespace(pk='one', is_authenticated=True))
        self.assertEqual(TestLoginView.as_view()(request).status_code, 200)
        enforce.assert_called_once_with([('login_ip', '127.0.0.1'), ('login_identifier', 'u@example.com')])

    @patch('apps.common.throttling.enforce_limits')
    def test_missing_or_malformed_identifier_still_charges_ip(self, enforce):
        for value in (None, [], {}, 123):
            enforce.reset_mock()
            request = self.factory.post('/', {'identifier': value}, format='json')
            self.assertEqual(TestLoginView.as_view()(request).status_code, 200)
            enforce.assert_called_once_with([('login_ip', '127.0.0.1')])

    @patch('apps.common.throttling.enforce_limits')
    def test_options_and_unsupported_methods_preserve_behavior(self, enforce):
        self.assertEqual(TestLoginView.as_view()(self.factory.options('/')).status_code, 200)
        self.assertEqual(TestLoginView.as_view()(self.factory.get('/')).status_code, 405)
        enforce.assert_not_called()

    @patch('apps.common.throttling.enforce_limits', side_effect=Throttled(wait=7))
    def test_expensive_denial_never_invokes_work(self, enforce):
        TestExpensiveView.work.reset_mock()
        request = self.factory.post('/', {}, format='json')
        force_authenticate(request, user=SimpleNamespace(pk='one', is_authenticated=True))
        response = TestExpensiveView.as_view()(request)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Retry-After'], '7')
        self.assertEqual(response.data['error']['code'], 'throttled')
        TestExpensiveView.work.assert_not_called()

    @override_settings(RATE_LIMIT_BASELINE_MODE='enforce')
    @patch('apps.common.throttling.caches')
    def test_baseline_cache_outage_only_reads_fail_open(self, caches):
        caches.__getitem__.return_value.get.side_effect = redis.ConnectionError('secret')
        self.assertEqual(TestOrdinaryView.as_view()(self.factory.get('/')).status_code, 200)
        response = TestOrdinaryView.as_view()(self.factory.post('/', {}, format='json'))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data['error']['code'], 'rate_limit_unavailable')
        self.assertEqual(response['Retry-After'], '5')


@tag('integration')
@override_settings(RATE_LIMIT_MODE='enforce', RATE_LIMIT_KEY_SECRET='integration-secret-at-least-32-characters')
class RedisAdmissionTests(SimpleTestCase):
    """Run explicitly with RATE_LIMIT_TEST_REDIS_URL; missing infrastructure fails."""
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        url = os.environ.get('RATE_LIMIT_TEST_REDIS_URL')
        if not url:
            raise RuntimeError('Integration tests require RATE_LIMIT_TEST_REDIS_URL pointing to isolated Redis.')
        cls.redis_settings = override_settings(RATE_LIMIT_REDIS_URL=url)
        cls.redis_settings.enable()
        cls.redis_connection = get_redis_client()
        cls.redis_connection.ping()

    @classmethod
    def tearDownClass(cls):
        cls.redis_settings.disable()
        super().tearDownClass()

    def setUp(self):
        self.prefix = f'mobser:rl:integration:{uuid.uuid4().hex}:'
        self.settings_override = override_settings(
            RATE_LIMIT_KEY_PREFIX=self.prefix,
            CACHES={'default': {'BACKEND': 'django.core.cache.backends.redis.RedisCache',
                                'LOCATION': os.environ['RATE_LIMIT_TEST_REDIS_URL'], 'KEY_PREFIX': self.prefix}},
        )
        self.settings_override.enable()

    def tearDown(self):
        # Delete only this test's unique namespace, never shared cache/queue data.
        keys = list(self.redis_connection.scan_iter(match=f'{self.prefix}*'))
        if keys:
            self.redis_connection.delete(*keys)
        self.settings_override.disable()

    def test_signup_form_corrections_allow_ten_attempts_then_short_retry(self):
        client = APIClient()
        for _ in range(10):
            response = client.post('/api/v1/auth/signup/', {}, format='json')
            self.assertEqual(response.status_code, 400)
        response = client.post('/api/v1/auth/signup/', {}, format='json')
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['error']['code'], 'throttled')
        self.assertGreater(int(response['Retry-After']), 0)
        self.assertLessEqual(int(response['Retry-After']), 60)
        self.assertEqual(self.redis_connection.zcard(key_for('signup_ip', '127.0.0.1')), 10)

    def test_signup_hourly_budget_still_applies_after_burst_expires(self):
        seconds, micros = self.redis_connection.time()
        now = seconds * 1000 + micros // 1000
        key = key_for('signup_ip', '127.0.0.1')
        # Prior admitted requests are outside the minute window but inside the hour.
        self.redis_connection.zadd(key, {f'previous-{i}': now - 120000 for i in range(59)})
        client = APIClient()
        self.assertEqual(client.post('/api/v1/auth/signup/', {}, format='json').status_code, 400)
        response = client.post('/api/v1/auth/signup/', {}, format='json')
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response['Retry-After']), 60)
        self.assertLessEqual(int(response['Retry-After']), 3480)
        self.assertEqual(self.redis_connection.zcard(key), 60)

    @override_settings(RATE_LIMITS={'test': [(7, 60)]})
    def test_concurrent_connections_admit_exactly_limit(self):
        def attempt(_):
            try:
                enforce_limits([('test', 'same')])
                return True
            except Throttled:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(attempt, range(80)))
        self.assertEqual(sum(results), 7)
        self.assertEqual(self.redis_connection.zcard(key_for('test', 'same')), 7)
        self.assertGreater(self.redis_connection.ttl(key_for('test', 'same')), 0)

    @override_settings(RATE_LIMITS={'ip': [(1, 60)], 'identifier': [(1, 60)]})
    def test_denied_multi_bucket_request_debits_nothing_and_does_not_extend_ttl(self):
        enforce_limits([('identifier', 'blocked')])
        key = key_for('identifier', 'blocked')
        self.redis_connection.pexpire(key, 30000)
        with self.assertRaises(Throttled):
            enforce_limits([('ip', 'fresh'), ('identifier', 'blocked')])
        self.assertFalse(self.redis_connection.exists(key_for('ip', 'fresh')))
        self.assertLessEqual(self.redis_connection.pttl(key), 30000)
        enforce_limits([('ip', 'fresh'), ('identifier', 'other')])

    @override_settings(RATE_LIMITS={'short': [(1, 3)], 'long': [(1, 9)]})
    def test_maximum_wait_across_independent_buckets(self):
        enforce_limits([('short', 'one'), ('long', 'one')])
        with self.assertRaises(Throttled) as caught:
            enforce_limits([('short', 'one'), ('long', 'one')])
        self.assertEqual(caught.exception.wait, 9)

    @override_settings(RATE_LIMITS={'test': [(1, 1), (2, 60)]})
    def test_expiration_and_sustained_window(self):
        enforce_limits([('test', 'one')])
        with self.assertRaises(Throttled):
            enforce_limits([('test', 'one')])
        time.sleep(1.05)
        enforce_limits([('test', 'one')])
        time.sleep(1.05)
        with self.assertRaises(Throttled) as caught:
            enforce_limits([('test', 'one')])
        self.assertGreater(caught.exception.wait, 50)
        self.assertEqual(self.redis_connection.zcard(key_for('test', 'one')), 2)

    @override_settings(RATE_LIMITS={'test': [(1, 2)]})
    def test_rolling_window_does_not_reset_at_fixed_boundary(self):
        seconds, micros = self.redis_connection.time()
        now = seconds * 1000 + micros // 1000
        key = key_for('test', 'one')
        self.redis_connection.zadd(key, {'previous': now - 1100})
        self.redis_connection.expire(key, 2)
        with self.assertRaises(Throttled):
            enforce_limits([('test', 'one')])
        self.assertEqual(self.redis_connection.zcard(key), 1)

    @override_settings(RATE_LIMITS={'test': [(1, 60)]})
    def test_observe_namespace_is_isolated_from_enforcement(self):
        with override_settings(RATE_LIMIT_MODE='observe'):
            enforce_limits([('test', 'one')])
            enforce_limits([('test', 'one')])
        enforce_limits([('test', 'one')])
        with self.assertRaises(Throttled):
            enforce_limits([('test', 'one')])

    @override_settings(RATE_LIMITS={'send_recipient': [(1, 60)]})
    def test_shared_recipient_budget_and_independent_channels(self):
        reserve_send(' User@Example.com ', 'email')
        with self.assertRaises(Throttled):
            reserve_send('user@example.com', 'email')
        reserve_send('01039811349', 'whatsapp')
        with self.assertRaises(Throttled):
            reserve_send('+201039811349', 'whatsapp')


    @override_settings(RATE_LIMIT_BASELINE_MODE='enforce',
                       RATE_LIMIT_BASELINE_RATES={'anonymous': '1/min', 'user': '1/min', 'status': '1/min'})
    def test_global_baseline_covers_public_aliases_and_independent_users_and_ips(self):
        client = APIClient()
        self.assertEqual(client.get('/api/hello/', REMOTE_ADDR='203.0.113.1').status_code, 200)
        limited = client.get('/api/common/hello/', REMOTE_ADDR='203.0.113.1')
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json()['error']['code'], 'throttled')
        self.assertGreater(int(limited['Retry-After']), 0)
        self.assertEqual(client.get('/api/hello/', REMOTE_ADDR='203.0.113.2').status_code, 200)
        for user_id in ('user-one', 'user-two'):
            client.force_authenticate(user=SimpleNamespace(pk=user_id, is_authenticated=True))
            self.assertEqual(client.get('/api/hello/', REMOTE_ADDR='203.0.113.1').status_code, 200)
            self.assertEqual(client.get('/api/common/hello/', REMOTE_ADDR='203.0.113.3').status_code, 429)

    @override_settings(RATE_LIMIT_BASELINE_MODE='enforce',
                       RATE_LIMIT_BASELINE_RATES={'anonymous': '3/min', 'user': '3/min', 'status': '1/min'})
    @patch('celery.app.task.Task.apply_async')
    @patch('apps.common.health.dependency_status', return_value={'database': 'up', 'redis': 'up'})
    def test_status_aliases_share_scope_and_compose_the_global_baseline(self, dependencies, enqueue):
        client = APIClient()
        response = client.get('/api/status/', REMOTE_ADDR='203.0.113.1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(client.get('/api/common/status/', REMOTE_ADDR='203.0.113.1').status_code, 429)
        self.assertEqual(client.get('/api/hello/', REMOTE_ADDR='203.0.113.1').status_code, 200)
        self.assertEqual(client.get('/api/hello/', REMOTE_ADDR='203.0.113.1').status_code, 429)
        for _ in range(3):
            self.assertEqual(client.get('/api/hello/', REMOTE_ADDR='203.0.113.2').status_code, 200)
        self.assertEqual(client.get('/api/status/', REMOTE_ADDR='203.0.113.2').status_code, 429)
        dependencies.assert_called_once()
        enqueue.assert_not_called()

    @override_settings(RATE_LIMIT_BASELINE_MODE='enforce',
                       RATE_LIMIT_BASELINE_RATES={'anonymous': '1/min', 'user': '1/min', 'status': '1/min'})
    def test_operational_probes_bypass_exhausted_and_unavailable_limiters(self):
        client = APIClient()
        self.assertEqual(client.get('/api/hello/').status_code, 200)
        self.assertEqual(client.get('/api/hello/').status_code, 429)
        with patch('apps.common.observability.dependency_status', return_value={'database': 'up', 'redis': 'up'}):
            for url in ('/api/health/live/', '/api/health/ready/'):
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertIn('no-store', response['Cache-Control'])
        with patch('apps.common.throttling.caches') as cache, \
             patch('apps.common.rate_limits.get_redis_client', side_effect=redis.ConnectionError()) as strict, \
             patch('apps.common.observability.dependency_status', return_value={'database': 'up', 'redis': 'down'}):
            cache.__getitem__.side_effect = redis.ConnectionError()
            self.assertEqual(client.get('/api/health/live/').status_code, 200)
            response = client.get('/api/health/ready/')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['error']['fields'], {'database': ['up'], 'redis': ['down']})
            self.assertIn('no-store', response['Cache-Control'])
            cache.__getitem__.assert_not_called()
            strict.assert_not_called()
