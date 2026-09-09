"""Account policy wiring and real Redis admission tests."""
import os
import uuid
from unittest.mock import patch

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings, tag
from django.urls import resolve
from rest_framework.exceptions import Throttled
from rest_framework.test import APITestCase

from apps.accounts.models import User, UserStatus, VerificationChallenge, VerificationPurpose
from apps.accounts.services.password import (
    PASSWORD_RESET_SALT, initiate_password_reset, reset_password_with_token,
)
from apps.accounts.services.profile import confirm_phone_change
from apps.accounts.services.signup import signup_user
from apps.accounts.services.verification import create_verification_challenge, confirm_signup
from apps.common.rate_limits import RateLimitUnavailable, get_redis_client
from apps.common.throttling import BaselineThrottle, OperationThrottle


class AccountPolicyWiringTests(TestCase):
    def test_all_account_aliases_compose_baseline_and_operation(self):
        operations = {
            'signup/': 'signup', 'login/': 'login', 'logout/': 'logout',
            'password/forgot/': 'forgot', 'password/reset/verify/': 'confirm',
            'password/reset/': 'reset', 'password/change/': 'sensitive',
            'verification/confirm/': 'confirm', 'verification/resend/': 'resend',
            'phone/change/': 'sensitive', 'phone/change/confirm/': 'confirm',
            'email/change/': 'sensitive', 'social/google/': 'social',
            'token/refresh/': 'refresh',
        }
        for prefix in ('/api/v1/auth/', '/api/accounts/'):
            for path, operation in operations.items():
                with self.subTest(path=prefix + path):
                    view = resolve(prefix + path).func.cls
                    self.assertEqual(view.rate_limit_operation, operation)
                    self.assertEqual(view.throttle_classes, [BaselineThrottle, OperationThrottle])
        for prefix in ('/api/v1/auth/', '/api/accounts/'):
            profile = resolve(prefix + 'me/').func.cls
            self.assertEqual(profile.throttle_classes, [BaselineThrottle, OperationThrottle])
            self.assertEqual(profile.rate_limit_operation, {'PATCH': 'profile_update', 'DELETE': 'sensitive'})
            self.assertIsNone(profile.rate_limit_operation.get('GET'))
            providers = resolve(prefix + 'social/providers/').func.cls
            self.assertEqual(providers.throttle_classes, [BaselineThrottle])
            self.assertFalse(hasattr(providers, 'rate_limit_operation'))
        for path, operation in (('/api/token/', 'login'), ('/api/token/refresh/', 'refresh'), ('/api/token/verify/', 'verify')):
            self.assertEqual(resolve(path).func.cls.rate_limit_operation, operation)

    @patch('apps.accounts.services.signup.reserve_send', side_effect=Throttled(wait=60))
    @patch('apps.messaging.tasks.send_verification_message.delay')
    def test_signup_send_denial_creates_nothing(self, send, reserve):
        with self.assertRaises(Throttled):
            signup_user(email='new@example.com', phone='+201012345678', password='Password123!')
        self.assertFalse(User.objects.exists())
        self.assertFalse(VerificationChallenge.objects.exists())
        send.assert_not_called()

    @patch('apps.accounts.services.password.ensure_available', side_effect=RateLimitUnavailable())
    @patch('apps.accounts.services.password.get_user_by_identifier')
    def test_recovery_outage_precedes_lookup(self, lookup, available):
        with self.assertRaises(RateLimitUnavailable):
            initiate_password_reset('unknown@example.com')
        lookup.assert_not_called()

    @patch('apps.accounts.services.password.enforce_limits')
    def test_reset_subject_is_never_read_from_invalid_signature(self, enforce):
        with self.assertRaises(ValidationError):
            reset_password_with_token('forged-token', 'Password123!')
        enforce.assert_not_called()

    @patch('apps.accounts.services.password.enforce_limits', side_effect=Throttled(wait=60))
    def test_verified_reset_subject_checked_before_password_write(self, enforce):
        user = User.objects.create_user(email='reset@example.com', phone='+201012345678', password='OldPassword123!')
        token = signing.TimestampSigner(salt=PASSWORD_RESET_SALT).sign_object({
            'user_id': str(user.id), 'token_version': user.token_version,
        })
        with self.assertRaises(Throttled):
            reset_password_with_token(token, 'NewPassword123!')
        enforce.assert_called_once_with([('reset_subject', str(user.id))])
        user.refresh_from_db()
        self.assertTrue(user.check_password('OldPassword123!'))

    def test_wrong_owner_and_generic_route_do_not_consume_phone_change(self):
        owner = User.objects.create_user(email='owner@example.com', phone='+201012345678', password='Password123!')
        other = User.objects.create_user(email='other@example.com', phone='+201012345679', password='Password123!')
        challenge, code = create_verification_challenge(owner, VerificationPurpose.CHANGE_PHONE, '+201012345670', metadata={'new_phone': '+201012345670'})
        with self.assertRaises(ValidationError):
            confirm_phone_change(other, str(challenge.id), code)
        with self.assertRaises(ValidationError):
            confirm_signup(str(challenge.id), code)
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)
        self.assertEqual(challenge.attempt_count, 0)

    @patch('apps.accounts.services.signup.reserve_send')
    def test_signup_reserves_send_exactly_once(self, reserve):
        signup_user(email='signup@example.com', phone='+201012345678', password='Password123!')
        reserve.assert_called_once_with('+201012345678', 'whatsapp')
        self.assertEqual(VerificationChallenge.objects.count(), 1)

    @patch('apps.accounts.services.verification.reserve_send', side_effect=Throttled(wait=60))
    def test_phone_and_deletion_send_denials_create_no_challenge(self, reserve):
        from apps.accounts.services.profile import initiate_phone_change
        from apps.accounts.services.deletion import initiate_account_deletion
        user = User.objects.create_user(email='owner@example.com', phone='+201012345678', password='Password123!')
        with self.assertRaises(Throttled):
            initiate_phone_change(user, '+201012345679')
        with self.assertRaises(Throttled):
            initiate_account_deletion(user, 'Password123!')
        self.assertFalse(VerificationChallenge.objects.exists())

    @patch('apps.accounts.services.social.service.enforce_limits', side_effect=Throttled(wait=60))
    @patch('apps.accounts.services.social.service.get_verifier')
    def test_social_subject_is_verified_before_admission_and_no_user_is_created(self, verifier, enforce):
        from apps.accounts.services.social.base import SocialIdentity
        from apps.accounts.services.social.service import authenticate_with_social_provider
        verifier.return_value.return_value = SocialIdentity('google', 'verified-subject', 'person@example.com')
        with self.assertRaises(Throttled):
            authenticate_with_social_provider(provider='google', token='external-token')
        verifier.return_value.assert_called_once_with('external-token')
        enforce.assert_called_once_with([('social_subject', 'google:verified-subject')])
        self.assertFalse(User.objects.exists())

    @patch('apps.accounts.api.views.auth.enforce_limits')
    def test_forged_refresh_cannot_charge_subject_quota(self, enforce):
        from apps.accounts.api.views.auth import RateLimitedTokenRefreshSerializer
        from rest_framework_simplejwt.exceptions import TokenError
        serializer = RateLimitedTokenRefreshSerializer(data={'refresh': 'forged-token'})
        with self.assertRaises(TokenError):
            serializer.is_valid(raise_exception=True)
        enforce.assert_not_called()

    @patch('apps.accounts.services.authentication.rotate_refresh_token')
    @patch('apps.accounts.api.views.auth.enforce_limits', side_effect=Throttled(wait=60))
    def test_verified_refresh_denial_does_not_rotate_session(self, enforce, rotate):
        from apps.accounts.api.views.auth import RateLimitedTokenRefreshSerializer
        from apps.accounts.services.authentication import SessionRefreshToken
        user = User.objects.create_user(email='refresh@example.com', phone='+201012345678', password='Password123!')
        token = str(SessionRefreshToken.for_user(user))
        serializer = RateLimitedTokenRefreshSerializer(data={'refresh': token})
        with self.assertRaises(Throttled):
            serializer.is_valid(raise_exception=True)
        enforce.assert_called_once_with([('refresh_subject', str(user.id))])
        rotate.assert_not_called()


@tag('integration')
@override_settings(RATE_LIMIT_MODE='enforce', RATE_LIMIT_BASELINE_MODE='off', RATE_LIMIT_ALLOW_DIRECT=True, RATE_LIMIT_TRUST_PROXY=False)
class AccountRedisThrottleTests(APITestCase):
    def setUp(self):
        url = os.environ.get("RATE_LIMIT_TEST_REDIS_URL")
        self.assertTrue(url, "Set RATE_LIMIT_TEST_REDIS_URL to an isolated real Redis.")
        redis_config = override_settings(RATE_LIMIT_REDIS_URL=url)
        redis_config.enable()
        self.addCleanup(redis_config.disable)
        self.redis = get_redis_client()
        self.redis.ping()  # A missing real Redis fails explicitly; never silently skip.
        self.prefix = f'mobser:rl:test:accounts:{uuid.uuid4().hex}:'
        self.config = override_settings(RATE_LIMIT_KEY_PREFIX=self.prefix)
        self.config.enable()
        self.addCleanup(self.config.disable)
        self.addCleanup(self.clear_keys)

    def clear_keys(self):
        keys = list(self.redis.scan_iter(match=self.prefix + '*'))
        if keys:
            self.redis.delete(*keys)

    @patch('apps.accounts.api.views.auth.authenticate_user', side_effect=ValidationError('Invalid credentials.'))
    def test_login_identifier_bucket_spans_aliases_ips_and_normalization(self, authenticate):
        aliases = ['/api/v1/auth/login/', '/api/accounts/login/', '/api/token/']
        for index in range(10):
            response = self.client.post(aliases[index % 3], {
                'identifier': '  Shared@Example.com ', 'email': '  Shared@Example.com ', 'password': 'wrong',
            }, format='json', REMOTE_ADDR=f'192.0.2.{index + 1}')
            self.assertNotEqual(response.status_code, 429)
        before = authenticate.call_count
        response = self.client.post('/api/v1/auth/login/', {
            'identifier': 'shared@example.com', 'password': 'wrong',
        }, format='json', REMOTE_ADDR='198.51.100.99')
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response['Retry-After']), 0)
        self.assertEqual(authenticate.call_count, before)

    def test_missing_identifiers_still_consume_ip_quota_and_unsupported_methods_do_not(self):
        policies = {**settings.RATE_LIMITS, 'login_ip': [(1, 60)]}
        with override_settings(RATE_LIMITS=policies):
            for _ in range(2):
                self.assertEqual(self.client.get('/api/v1/auth/login/').status_code, 405)
                self.assertEqual(self.client.options('/api/v1/auth/login/').status_code, 200)
            self.assertEqual(self.client.post('/api/v1/auth/login/', {}, format='json').status_code, 400)
            self.assertEqual(self.client.post('/api/v1/auth/login/', {}, format='json').status_code, 429)

    @patch('apps.messaging.tasks.send_verification_message.delay')
    def test_fresh_challenges_share_recipient_budget_across_purposes(self, send):
        user = User.objects.create_user(email='shared@example.com', phone='+201012345678', password='Password123!', status=UserStatus.ACTIVE)
        user.phone_verified_at = user.created_at
        user.save()
        with self.captureOnCommitCallbacks(execute=True):
            result = initiate_password_reset(user.email)
        self.assertIn('challenge_id', result)
        with self.captureOnCommitCallbacks(execute=True):
            suppressed = initiate_password_reset(user.email)
        self.assertEqual(suppressed, {'message': 'If an account exists, verification instructions were sent.'})
        with self.assertRaises(Throttled):
            create_verification_challenge(user, VerificationPurpose.DELETE_ACCOUNT, '01012345678')
        self.assertEqual(VerificationChallenge.objects.count(), 1)
        send.assert_called_once()

    @patch('apps.accounts.api.views.auth.authenticate_user')
    def test_redis_outage_rejects_login_before_password_check(self, authenticate):
        with override_settings(RATE_LIMIT_REDIS_URL='redis://127.0.0.1:1/0'):
            response = self.client.post('/api/v1/auth/login/', {'identifier': 'any@example.com', 'password': 'wrong'}, format='json')
        self.assertEqual(response.status_code, 503)
        authenticate.assert_not_called()
