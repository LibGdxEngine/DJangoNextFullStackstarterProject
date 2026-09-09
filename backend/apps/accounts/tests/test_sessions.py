from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.core import signing
from django.core.exceptions import ValidationError
from django.db import close_old_connections
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import AuthSession, User, UserStatus, VerificationPurpose
from apps.accounts.services.authentication import (
    SessionRefreshToken, issue_tokens_for_user, rotate_refresh_token,
)
from apps.accounts.services.verification import create_verification_challenge


def make_user():
    return User.objects.create_user(
        email="session@example.com", phone="+201011112222", password="StrongPassword123!",
        status=UserStatus.ACTIVE, phone_verified_at=timezone.now(),
    )


class SessionAPITests(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.tokens = issue_tokens_for_user(self.user)

    def refresh(self, token):
        return self.client.post(reverse("auth:token_refresh"), {"refresh": token}, format="json")

    def me(self, access):
        return self.client.get(reverse("auth:me"), HTTP_AUTHORIZATION=f"Bearer {access}")

    def test_rotation_replay_revokes_descendant_refresh_and_access(self):
        response = self.refresh(self.tokens["refresh"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.me(response.data["access"]).status_code, 200)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)
        self.assertEqual(self.refresh(response.data["refresh"]).status_code, 401)
        self.assertEqual(self.me(response.data["access"]).status_code, 401)
        self.assertIsNotNone(AuthSession.objects.get().revoked_at)

    def test_logout_consumed_refresh_is_idempotent_and_revokes_access(self):
        rotated = self.refresh(self.tokens["refresh"]).data
        for _ in range(2):
            response = self.client.post(reverse("auth:logout"), {"refresh": self.tokens["refresh"]}, format="json")
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.me(rotated["access"]).status_code, 401)
        self.assertEqual(self.refresh(rotated["refresh"]).status_code, 401)

    def test_refresh_keeps_absolute_expiry_and_caps_access(self):
        session = AuthSession.objects.get()
        expiry = timezone.now() + timedelta(seconds=90)
        session.expires_at = expiry
        session.save(update_fields=["expires_at"])
        rotated = self.refresh(self.tokens["refresh"])
        self.assertEqual(rotated.status_code, 200)
        self.assertEqual(SessionRefreshToken(rotated.data["refresh"])["exp"], int(expiry.timestamp()))
        self.assertEqual(AccessToken(rotated.data["access"])["exp"], int(expiry.timestamp()))
        session.refresh_from_db()
        self.assertEqual(session.expires_at, expiry)

    def test_new_session_has_seven_day_absolute_lifetime(self):
        session = AuthSession.objects.get()
        self.assertAlmostEqual((session.expires_at - session.created_at).total_seconds(), 7 * 86400, delta=2)

    def test_expired_family_rejects_both_token_types(self):
        AuthSession.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.me(self.tokens["access"]).status_code, 401)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)

    def test_missing_version_and_session_claims_are_rejected(self):
        for claim in ("token_version", "sid", "scope"):
            with self.subTest(claim=claim):
                access = AccessToken(self.tokens["access"])
                refresh = SessionRefreshToken(self.tokens["refresh"])
                del access[claim]
                del refresh[claim]
                self.assertEqual(self.me(str(access)).status_code, 401)
                self.assertEqual(self.refresh(str(refresh)).status_code, 401)

    def test_stale_version_rejects_access_and_refresh(self):
        self.user.token_version += 1
        self.user.save(update_fields=["token_version"])
        self.assertEqual(self.me(self.tokens["access"]).status_code, 401)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)

    def test_restricted_accounts_reject_access_refresh_and_both_login_routes(self):
        for user_status in (UserStatus.PENDING, UserStatus.BLOCKED, UserStatus.DELETION_PENDING):
            with self.subTest(status=user_status):
                self.user.status = user_status
                self.user.save(update_fields=["status"])
                self.assertEqual(self.me(self.tokens["access"]).status_code, 401)
                self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)
                for route in ("auth:login", "api_token_obtain_pair"):
                    response = self.client.post(reverse(route), {"identifier": self.user.email, "password": "StrongPassword123!"})
                    self.assertIn(response.status_code, (401, 403))
        self.user.status = UserStatus.ACTIVE
        self.user.is_active = False
        self.user.save(update_fields=["status", "is_active"])
        self.assertEqual(self.me(self.tokens["access"]).status_code, 401)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)

    def test_legacy_login_creates_revocable_family(self):
        response = self.client.post(reverse("api_token_obtain_pair"), {"identifier": self.user.email, "password": "StrongPassword123!"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(AuthSession.objects.filter(pk=AccessToken(response.data["access"])["sid"]).exists())

    def test_basic_and_django_session_cannot_bypass_jwt_policy(self):
        import base64
        credentials = base64.b64encode(b"session@example.com:StrongPassword123!").decode()
        self.assertEqual(self.client.get(reverse("auth:me"), HTTP_AUTHORIZATION=f"Basic {credentials}").status_code, 401)
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(reverse("auth:me")).status_code, 401)

    def test_onboarding_session_is_limited_to_profile_read_and_phone_verification(self):
        self.user.phone_verified_at = None
        self.user.save(update_fields=["phone_verified_at"])
        tokens = issue_tokens_for_user(self.user, allow_phone_onboarding=True)
        self.assertEqual(self.me(tokens["access"]).status_code, 200)
        headers = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}
        self.assertEqual(self.client.patch(reverse("auth:me"), {"first_name": "Changed"}, **headers).status_code, 403)
        self.assertEqual(self.client.get("/api/organizations/", **headers).status_code, 403)
        with patch("apps.messaging.tasks.send_verification_message.delay"):
            result = self.client.post(reverse("auth:phone_change_initiate"), {"new_phone": self.user.phone}, **headers)
        self.assertEqual(result.status_code, 200)

    def test_old_signup_challenge_cannot_reactivate_blocked_user(self):
        challenge, code = create_verification_challenge(
            user=self.user, purpose=VerificationPurpose.SIGNUP, destination=self.user.phone,
        )
        self.user.status = UserStatus.BLOCKED
        self.user.save(update_fields=["status"])
        response = self.client.post(reverse("auth:verification_confirm"), {"challenge_id": str(challenge.id), "code": code})
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.BLOCKED)

    def test_signup_rechecks_status_after_challenge_user_was_loaded(self):
        challenge, code = create_verification_challenge(
            user=self.user, purpose=VerificationPurpose.SIGNUP, destination=self.user.phone,
        )
        # Model the security update occurring after OTP validation loaded user.
        challenge.user = self.user
        User.objects.filter(pk=self.user.pk).update(status=UserStatus.DELETION_PENDING)
        with patch("apps.accounts.services.verification.VerificationChallenge.objects.select_for_update") as locked_challenges:
            locked_challenges.return_value.get.return_value = challenge
            response = self.client.post(reverse("auth:verification_confirm"), {"challenge_id": str(challenge.id), "code": code})
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.DELETION_PENDING)

    def test_invalid_signature_cannot_revoke_session(self):
        token = self.tokens["refresh"]
        header, payload, signature = token.split(".")
        signature = ("A" if signature[0] != "A" else "B") + signature[1:]
        tampered = ".".join((header, payload, signature))
        self.assertEqual(self.refresh(tampered).status_code, 401)
        logout = self.client.post(reverse("auth:logout"), {"refresh": tampered})
        self.assertEqual(logout.status_code, 400)
        self.assertIsNone(AuthSession.objects.get().revoked_at)
        self.assertEqual(self.me(self.tokens["access"]).status_code, 200)

    @override_settings(EXPIRED_TOKEN_RETENTION_DAYS=1)
    def test_expired_session_cleanup_preserves_retention_and_live_families(self):
        from apps.accounts.tasks.cleanup import purge_expired_jwt_tokens
        expired = AuthSession.objects.get()
        AuthSession.objects.filter(pk=expired.pk).update(expires_at=timezone.now() - timedelta(days=2))
        issue_tokens_for_user(self.user)
        recent = AuthSession.objects.exclude(pk=expired.pk).get()
        AuthSession.objects.filter(pk=recent.pk).update(expires_at=timezone.now() - timedelta(hours=1))
        issue_tokens_for_user(self.user)
        self.assertEqual(purge_expired_jwt_tokens(), 1)
        self.assertEqual(AuthSession.objects.count(), 2)
        self.assertTrue(AuthSession.objects.filter(pk=recent.pk).exists())

    def test_stale_request_cannot_overwrite_newer_account_revocation(self):
        from apps.accounts.services.password import change_password
        from apps.accounts.services.profile import change_email, confirm_phone_change
        from apps.accounts.services.deletion import confirm_account_deletion
        User.objects.filter(pk=self.user.pk).update(token_version=2)
        operations = (
            lambda: change_password(self.user, "StrongPassword123!", "ChangedPassword123!"),
            lambda: change_email(self.user, "changed@example.com", "StrongPassword123!"),
            lambda: confirm_phone_change(self.user, "unused", "123456"),
            lambda: confirm_account_deletion(self.user, "unused", "123456"),
        )
        for operation in operations:
            with self.assertRaises(ValidationError):
                operation()
        current_user = User.objects.get(pk=self.user.pk)
        self.assertEqual(current_user.token_version, 2)
        self.assertTrue(current_user.check_password("StrongPassword123!"))
        self.assertEqual(current_user.email, "session@example.com")

    def test_sign_in_cannot_issue_new_session_after_credentials_change(self):
        from apps.accounts.services.authentication import authenticate_user
        authenticated = authenticate_user(self.user.email, "StrongPassword123!")
        User.objects.filter(pk=self.user.pk).update(token_version=2)
        with self.assertRaises(ValidationError):
            issue_tokens_for_user(authenticated)
        self.assertEqual(AuthSession.objects.count(), 1)

    def test_wrong_step_up_codes_persist_attempt_limits(self):
        from apps.accounts.services.profile import confirm_phone_change
        from apps.accounts.services.deletion import confirm_account_deletion
        for purpose, confirm in (
            (VerificationPurpose.CHANGE_PHONE, confirm_phone_change),
            (VerificationPurpose.DELETE_ACCOUNT, confirm_account_deletion),
        ):
            challenge, code = create_verification_challenge(
                user=self.user, purpose=purpose, destination=self.user.phone,
                metadata={"new_phone": "+201055556666"},
            )
            wrong_code = "000000" if code != "000000" else "111111"
            for attempt in range(challenge.max_attempts):
                with self.assertRaises(ValidationError):
                    confirm(self.user, str(challenge.pk), wrong_code)
                challenge.refresh_from_db()
                self.assertEqual(challenge.attempt_count, attempt + 1)
            with self.assertRaises(ValidationError):
                confirm(self.user, str(challenge.pk), code)
            challenge.refresh_from_db()
            self.assertIsNone(challenge.consumed_at)

    def test_verify_endpoint_rejects_revoked_access(self):
        AuthSession.objects.update(revoked_at=timezone.now())
        response = self.client.post(reverse("api_token_verify"), {"token": self.tokens["access"]})
        self.assertEqual(response.status_code, 401)


class ConcurrentRefreshTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_only_one_refresh_wins_and_replay_revocation_is_committed(self):
        token = issue_tokens_for_user(make_user())["refresh"]
        barrier = Barrier(2)

        def refresh():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try:
                    return rotate_refresh_token(token)
                except InvalidToken:
                    return None
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: refresh(), range(2)))
        winners = [result for result in results if result]
        self.assertEqual(len(winners), 1)
        self.assertIsNotNone(AuthSession.objects.get().revoked_at)
        with self.assertRaises(InvalidToken):
            rotate_refresh_token(winners[0]["refresh"])
        client = APIClient()
        response = client.get(reverse("auth:me"), HTTP_AUTHORIZATION=f"Bearer {winners[0]['access']}")
        self.assertEqual(response.status_code, 401)

    @skipUnlessDBFeature("has_select_for_update")
    def test_password_reset_credential_can_only_be_consumed_once_concurrently(self):
        from apps.accounts.services.password import PASSWORD_RESET_SALT, reset_password_with_token
        user = make_user()
        reset_token = signing.TimestampSigner(salt=PASSWORD_RESET_SALT).sign_object({
            "user_id": str(user.pk), "token_version": user.token_version,
        })
        barrier = Barrier(2)

        def reset(password):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try:
                    reset_password_with_token(reset_token, password)
                    return password
                except ValidationError:
                    return None
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(reset, ("NewPassword123!", "OtherPassword123!")))
        winners = [result for result in results if result]
        self.assertEqual(len(winners), 1)
        user.refresh_from_db()
        self.assertEqual(user.token_version, 2)
        self.assertTrue(user.check_password(winners[0]))
