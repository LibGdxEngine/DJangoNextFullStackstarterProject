"""Run explicitly with --tag=integration against PostgreSQL, never SQLite."""
import os
import uuid
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection, transaction
from django.test import TransactionTestCase, override_settings, tag
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.exceptions import Throttled
from apps.common.rate_limits import get_redis_client

from apps.accounts.models import User, UserStatus, VerificationPurpose
from apps.accounts.services.verification import (
    confirm_signup, create_verification_challenge, resend_verification_challenge,
    verify_challenge_code, verify_challenge_outcome,
)


@tag('integration')
@override_settings(RATE_LIMIT_MODE='off', RATE_LIMIT_BASELINE_MODE='off')
class VerificationConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql', 'OTP races require real PostgreSQL row locks.')
        self.user = User.objects.create_user(email='race@example.com', phone='+201012345678', password='Password123!')
        self.challenge, self.code = create_verification_challenge(self.user, VerificationPurpose.SIGNUP, self.user.phone)

    def race(self, count, work):
        barrier = Barrier(count)
        def run(_):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try:
                    work()
                    return True
                except (ValidationError, Throttled):
                    return False
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=count) as pool:
            return list(pool.map(run, range(count)))

    def test_concurrent_wrong_codes_persist_exactly_five_attempts(self):
        results = self.race(8, lambda: verify_challenge_code(str(self.challenge.id), '000000'))
        self.assertFalse(any(results))
        self.challenge.refresh_from_db()
        self.assertEqual(self.challenge.attempt_count, 5)
        self.assertIsNone(self.challenge.consumed_at)

    def test_simultaneous_success_consumes_and_activates_once(self):
        results = self.race(4, lambda: confirm_signup(str(self.challenge.id), self.code))
        self.assertEqual(sum(results), 1)
        self.challenge.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(self.challenge.attempt_count, 1)
        self.assertEqual(self.user.status, UserStatus.ACTIVE)
        self.assertIsNotNone(self.user.phone_verified_at)

    def test_concurrent_resends_cannot_bypass_cooldown_or_maximum(self):
        self.challenge.last_sent_at = timezone.now() - timedelta(seconds=65)
        self.challenge.resend_count = 4
        self.challenge.save()
        results = self.race(4, lambda: resend_verification_challenge(str(self.challenge.id)))
        self.assertEqual(sum(results), 1)
        self.challenge.refresh_from_db()
        self.assertEqual(self.challenge.resend_count, 5)

    def test_failed_attempt_survives_real_http_error(self):
        response = APIClient().post('/api/v1/auth/verification/confirm/', {
            'challenge_id': str(self.challenge.id), 'code': '000000',
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.challenge.refresh_from_db()
        self.assertEqual(self.challenge.attempt_count, 1)

    def test_nested_owner_commits_failure_before_mapping_to_error(self):
        with transaction.atomic():
            with transaction.atomic():
                outcome = verify_challenge_outcome(str(self.challenge.id), '000000')
            with self.assertRaisesMessage(RuntimeError, 'Commit the verification transaction'):
                outcome.unwrap()
        with self.assertRaises(ValidationError):
            outcome.unwrap()
        self.challenge.refresh_from_db()
        self.assertEqual(self.challenge.attempt_count, 1)

    def test_implicit_nested_owner_is_rejected_before_attempt(self):
        with transaction.atomic():
            with self.assertRaises(RuntimeError):
                verify_challenge_code(str(self.challenge.id), '000000')
        self.challenge.refresh_from_db()
        self.assertEqual(self.challenge.attempt_count, 0)

    def test_business_failure_rolls_back_successful_consumption(self):
        def fail(challenge):
            challenge.user.status = UserStatus.ACTIVE
            challenge.user.save(update_fields=['status'])
            raise ValidationError('Business update rejected.')
        with self.assertRaises(ValidationError):
            verify_challenge_code(str(self.challenge.id), self.code, on_verified=fail)
        self.challenge.refresh_from_db()
        self.user.refresh_from_db()
        self.assertIsNone(self.challenge.consumed_at)
        self.assertEqual(self.challenge.attempt_count, 0)
        self.assertEqual(self.user.status, UserStatus.PENDING)

    def test_failed_reset_attempt_commits_when_atomic_requests_enabled(self):
        self.challenge.purpose = VerificationPurpose.PASSWORD_RESET
        self.challenge.save(update_fields=['purpose'])
        with patch.dict(connection.settings_dict, {'ATOMIC_REQUESTS': True}):
            response = APIClient().post('/api/v1/auth/password/reset/verify/', {
                'challenge_id': str(self.challenge.id), 'code': '000000',
            }, format='json')
        self.assertEqual(response.status_code, 400)
        self.challenge.refresh_from_db()
        self.assertEqual(self.challenge.attempt_count, 1)

    def test_concurrent_fresh_challenges_reserve_shared_recipient_once(self):
        url = os.environ.get('RATE_LIMIT_TEST_REDIS_URL')
        self.assertTrue(url, 'Set RATE_LIMIT_TEST_REDIS_URL to an isolated real Redis.')
        prefix = f'mobser:rl:test:send-race:{uuid.uuid4().hex}:'
        with override_settings(RATE_LIMIT_REDIS_URL=url, RATE_LIMIT_MODE='enforce', RATE_LIMIT_KEY_PREFIX=prefix):
            redis = get_redis_client()
            redis.ping()
            try:
                results = self.race(6, lambda: create_verification_challenge(
                    self.user, VerificationPurpose.PASSWORD_RESET, self.user.phone,
                ))
                self.assertEqual(sum(results), 1)
                self.assertEqual(self.user.verification_challenges.filter(purpose=VerificationPurpose.PASSWORD_RESET).count(), 1)
            finally:
                keys = list(redis.scan_iter(match=prefix + '*'))
                if keys:
                    redis.delete(*keys)
