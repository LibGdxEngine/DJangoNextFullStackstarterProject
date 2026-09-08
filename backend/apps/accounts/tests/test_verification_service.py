from datetime import timedelta
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from apps.accounts.models import User, VerificationChannel, VerificationPurpose
from apps.accounts.services.verification import (
    create_verification_challenge,
    verify_challenge_code,
    resend_verification_challenge,
    compute_code_digest,
)


class VerificationServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="verify@example.com",
            phone="+201012345678",
            password="Password123!",
        )

    def test_create_and_verify_challenge(self):
        challenge, plain_code = create_verification_challenge(
            user=self.user,
            purpose=VerificationPurpose.SIGNUP,
            destination=self.user.phone,
            channel=VerificationChannel.WHATSAPP,
        )
        self.assertNotEqual(challenge.code_digest, plain_code)
        self.assertEqual(challenge.code_digest, compute_code_digest(plain_code))
        self.assertFalse(challenge.is_consumed())
        self.assertFalse(challenge.is_expired())

        verified_challenge = verify_challenge_code(
            challenge_id=str(challenge.id),
            code=plain_code,
            expected_purpose=VerificationPurpose.SIGNUP,
        )
        self.assertTrue(verified_challenge.is_consumed())
        self.assertIsNotNone(verified_challenge.consumed_at)

    def test_verify_fails_with_invalid_code(self):
        challenge, plain_code = create_verification_challenge(
            user=self.user,
            purpose=VerificationPurpose.SIGNUP,
            destination=self.user.phone,
        )
        with self.assertRaises(ValidationError) as ctx:
            verify_challenge_code(challenge_id=str(challenge.id), code="000000")
        self.assertIn("Invalid verification code", str(ctx.exception))

        challenge.refresh_from_db()
        self.assertEqual(challenge.attempt_count, 1)

    def test_verify_fails_when_expired(self):
        challenge, plain_code = create_verification_challenge(
            user=self.user,
            purpose=VerificationPurpose.SIGNUP,
            destination=self.user.phone,
        )
        challenge.expires_at = timezone.now() - timedelta(seconds=1)
        challenge.save()

        with self.assertRaises(ValidationError) as ctx:
            verify_challenge_code(challenge_id=str(challenge.id), code=plain_code)
        self.assertIn("expired", str(ctx.exception))

    def test_resend_challenge_with_cooldown(self):
        challenge, plain_code = create_verification_challenge(
            user=self.user,
            purpose=VerificationPurpose.SIGNUP,
            destination=self.user.phone,
        )

        # Immediate resend should trigger cooldown error
        with self.assertRaises(ValidationError) as ctx:
            resend_verification_challenge(challenge_id=str(challenge.id), cooldown_seconds=60)
        self.assertIn("wait", str(ctx.exception))

        # Advance last_sent_at past cooldown
        challenge.last_sent_at = timezone.now() - timedelta(seconds=65)
        challenge.save()

        updated_challenge, new_code = resend_verification_challenge(
            challenge_id=str(challenge.id),
            cooldown_seconds=60,
        )
        self.assertEqual(updated_challenge.resend_count, 1)
        self.assertEqual(updated_challenge.code_digest, compute_code_digest(new_code))
