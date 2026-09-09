from unittest.mock import patch

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import AuthSession, User, UserStatus, VerificationChallenge
from apps.accounts.services.authentication import issue_tokens_for_user, SessionRefreshToken
from apps.accounts.services.verification import compute_code_digest


class AuthSessionAPITests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="session@example.com", phone="+12025550123", password="Password123!",
            status=UserStatus.ACTIVE, phone_verified_at=timezone.now(),
        )
        self.tokens = issue_tokens_for_user(self.user)

    def refresh(self, token):
        return self.client.post(reverse("auth:token_refresh"), {"refresh": token}, format="json")

    def profile(self, token):
        return self.client.get(reverse("auth:me"), HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_refresh_advances_persisted_family_and_keeps_session_id(self):
        original = SessionRefreshToken(self.tokens["refresh"])
        response = self.refresh(self.tokens["refresh"])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rotated = SessionRefreshToken(response.data["refresh"])
        session = AuthSession.objects.get(pk=original["sid"])
        self.assertEqual(rotated["sid"], original["sid"])
        self.assertEqual(rotated["generation"], 1)
        self.assertEqual(session.generation, 1)
        self.assertEqual(session.refresh_jti, rotated["jti"])
        self.assertEqual(self.profile(response.data["access"]).status_code, status.HTTP_200_OK)

    def test_refresh_reuse_revokes_descendant_refresh_and_access(self):
        rotated = self.refresh(self.tokens["refresh"])
        self.assertEqual(rotated.status_code, status.HTTP_200_OK)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIsNotNone(AuthSession.objects.get(user=self.user).revoked_at)
        self.assertEqual(self.refresh(rotated.data["refresh"]).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.profile(rotated.data["access"]).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_legacy_refresh_route_enforces_session_rotation(self):
        url = reverse("api_token_refresh")
        data = {"refresh": self.tokens["refresh"]}
        self.assertEqual(self.client.post(url, data, format="json").status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.post(url, data, format="json").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_revokes_access_and_refresh_and_is_repeatable(self):
        for _ in range(2):
            response = self.client.post(
                reverse("auth:logout"), {"refresh": self.tokens["refresh"]}, format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.profile(self.tokens["access"]).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_missing_session_rejects_access(self):
        AuthSession.objects.filter(user=self.user).delete()
        self.assertEqual(self.profile(self.tokens["access"]).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_expired_session_rejects_access_and_refresh(self):
        AuthSession.objects.filter(user=self.user).update(expires_at=timezone.now())
        self.assertEqual(self.profile(self.tokens["access"]).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_changed_token_version_rejects_refresh(self):
        self.user.token_version += 1
        self.user.save(update_fields=["token_version"])
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_legacy_tokens_can_authenticate_refresh_and_logout(self):
        legacy = RefreshToken.for_user(self.user)
        legacy["token_version"] = self.user.token_version
        self.assertEqual(self.profile(str(legacy.access_token)).status_code, status.HTTP_200_OK)
        refreshed = self.refresh(str(legacy))
        self.assertEqual(refreshed.status_code, status.HTTP_200_OK)
        response = self.client.post(
            reverse("auth:logout"), {"refresh": refreshed.data["refresh"]}, format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.refresh(refreshed.data["refresh"]).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_legacy_login_issues_revocable_session_tokens(self):
        response = self.client.post(reverse("api_token_obtain_pair"), {
            "identifier": self.user.email, "password": "Password123!",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        token = SessionRefreshToken(response.data["refresh"])
        self.assertTrue(AuthSession.objects.filter(pk=token["sid"], user=self.user).exists())
        self.client.post(reverse("auth:logout"), {"refresh": response.data["refresh"]}, format="json")
        self.assertEqual(self.profile(response.data["access"]).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_legacy_login_rejects_ineligible_accounts(self):
        for user_status, active, verified in (
            (UserStatus.PENDING, True, False), (UserStatus.BLOCKED, True, True),
            (UserStatus.DELETION_PENDING, True, True), (UserStatus.ACTIVE, False, True),
            (UserStatus.ACTIVE, True, False),
        ):
            with self.subTest(status=user_status, active=active, verified=verified):
                self.user.status = user_status
                self.user.is_active = active
                self.user.phone_verified_at = timezone.now() if verified else None
                self.user.save()
                response = self.client.post(reverse("api_token_obtain_pair"), {
                    "identifier": self.user.email, "password": "Password123!",
                }, format="json")
                self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(AuthSession.objects.filter(user=self.user).count(), 1)

    def onboarding_tokens(self):
        self.user.phone = None
        self.user.phone_verified_at = None
        self.user.save(update_fields=["phone", "phone_verified_at"])
        return issue_tokens_for_user(self.user, allow_phone_onboarding=True)

    def test_onboarding_scope_denies_business_routes_and_profile_mutation(self):
        tokens = self.onboarding_tokens()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {tokens["access"]}')
        for name in ("organizations:organization-list", "billing:subscription_list"):
            with self.subTest(route=name):
                self.assertEqual(self.client.get(reverse(name)).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.patch(reverse("auth:me"), {"first_name": "Changed"}, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )
        for name in ("auth:me", "accounts:api:me"):
            self.assertEqual(self.client.get(reverse(name)).status_code, status.HTTP_200_OK)
        rotated = self.refresh(tokens["refresh"])
        self.assertEqual(rotated.status_code, status.HTTP_200_OK)
        self.assertEqual(SessionRefreshToken(rotated.data["refresh"])["scope"], "phone_onboarding")

    @patch("apps.messaging.tasks.send_verification_message.delay")
    def test_onboarding_can_complete_phone_verification(self, send):
        tokens = self.onboarding_tokens()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {tokens["access"]}')
        response = self.client.post(
            reverse("auth:phone_change_initiate"), {"new_phone": "+12025550124"}, format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        challenge = VerificationChallenge.objects.get(pk=response.data["challenge_id"])
        challenge.code_digest = compute_code_digest("123456")
        challenge.save(update_fields=["code_digest"])
        response = self.client.post(reverse("auth:phone_change_confirm"), {
            "challenge_id": str(challenge.pk), "code": "123456",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.phone_verified_at)
        self.assertEqual(self.profile(tokens["access"]).status_code, status.HTTP_401_UNAUTHORIZED)
        replacement = issue_tokens_for_user(self.user)
        self.assertEqual(SessionRefreshToken(replacement["refresh"])["scope"], "full")
