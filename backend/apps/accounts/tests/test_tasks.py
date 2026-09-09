from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.accounts.models import (
    User,
    VerificationChallenge,
    VerificationChannel,
    VerificationPurpose,
)
from apps.accounts.tasks import (
    purge_expired_jwt_tokens,
    purge_expired_verification_challenges,
)


class PurgeExpiredJwtTokensTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="tokens@example.com",
            phone="+201012345671",
            password="Password123!",
        )
        self._jti_counter = 0

    def _create_token(self, expires_at):
        self._jti_counter += 1
        return OutstandingToken.objects.create(
            user=self.user,
            jti=f"jti-{self._jti_counter}",
            token="dummy-token",
            created_at=timezone.now(),
            expires_at=expires_at,
        )

    def test_removes_tokens_past_retention_window(self):
        stale = self._create_token(timezone.now() - timedelta(days=5))
        live = self._create_token(timezone.now() + timedelta(days=5))

        removed = purge_expired_jwt_tokens()

        self.assertEqual(removed, 1)
        self.assertFalse(OutstandingToken.objects.filter(pk=stale.pk).exists())
        self.assertTrue(OutstandingToken.objects.filter(pk=live.pk).exists())

    def test_keeps_recently_expired_tokens(self):
        recent = self._create_token(timezone.now() - timedelta(minutes=5))

        removed = purge_expired_jwt_tokens()

        self.assertEqual(removed, 0)
        self.assertTrue(OutstandingToken.objects.filter(pk=recent.pk).exists())


class PurgeExpiredVerificationChallengesTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="challenges@example.com",
            phone="+201012345672",
            password="Password123!",
        )

    def _create_challenge(self, expires_at, consumed_at=None):
        return VerificationChallenge.objects.create(
            user=self.user,
            purpose=VerificationPurpose.SIGNUP,
            channel=VerificationChannel.WHATSAPP,
            destination=self.user.phone,
            code_digest="digest",
            expires_at=expires_at,
            consumed_at=consumed_at,
        )

    def test_removes_challenges_past_retention_window(self):
        stale = self._create_challenge(timezone.now() - timedelta(days=3))
        live = self._create_challenge(timezone.now() + timedelta(minutes=10))

        removed = purge_expired_verification_challenges()

        self.assertEqual(removed, 1)
        self.assertFalse(VerificationChallenge.objects.filter(pk=stale.pk).exists())
        self.assertTrue(VerificationChallenge.objects.filter(pk=live.pk).exists())

    def test_keeps_recently_expired_challenges(self):
        recent = self._create_challenge(timezone.now() - timedelta(minutes=5))

        removed = purge_expired_verification_challenges()

        self.assertEqual(removed, 0)
        self.assertTrue(VerificationChallenge.objects.filter(pk=recent.pk).exists())

    def test_removes_consumed_challenge_once_it_also_expires(self):
        consumed = self._create_challenge(
            timezone.now() - timedelta(days=3),
            consumed_at=timezone.now() - timedelta(days=3),
        )

        removed = purge_expired_verification_challenges()

        self.assertEqual(removed, 1)
        self.assertFalse(VerificationChallenge.objects.filter(pk=consumed.pk).exists())
