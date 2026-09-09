from unittest.mock import patch

from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import SocialAccount, User, UserStatus

GOOGLE_ENABLED = {"google": {"client_id": "test-client-id.apps.googleusercontent.com"}}
GOOGLE_DISABLED = {"google": {"client_id": ""}}

VERIFY_TARGET = "apps.accounts.services.social.google.google_id_token.verify_oauth2_token"


def google_claims(**overrides):
    claims = {
        "iss": "https://accounts.google.com",
        "sub": "google-sub-123",
        "email": "social@example.com",
        "email_verified": True,
        "given_name": "Social",
        "family_name": "User",
        "picture": "https://lh3.googleusercontent.com/a/avatar",
    }
    claims.update(overrides)
    return claims


@override_settings(SOCIAL_AUTH_PROVIDERS=GOOGLE_ENABLED)
class GoogleSignInAPITests(APITestCase):
    def setUp(self):
        self.url = reverse("auth:social_auth", kwargs={"provider": "google"})

    def sign_in(self, **claim_overrides):
        with patch(VERIFY_TARGET, return_value=google_claims(**claim_overrides)):
            return self.client.post(self.url, {"token": "any-google-id-token"}, format="json")

    def test_first_sign_in_creates_active_user_without_phone(self):
        res = self.sign_in()

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)
        self.assertTrue(res.data["created"])
        self.assertTrue(res.data["requires_phone"])

        user = User.objects.get(email="social@example.com")
        self.assertEqual(user.status, UserStatus.ACTIVE)
        self.assertIsNone(user.phone)
        self.assertIsNotNone(user.email_verified_at)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.first_name, "Social")

        social_account = SocialAccount.objects.get(user=user)
        self.assertEqual(social_account.provider, "google")
        self.assertEqual(social_account.provider_user_id, "google-sub-123")
        self.assertIsNotNone(social_account.last_login_at)

    def test_repeat_sign_in_reuses_the_same_user(self):
        first = self.sign_in()
        second = self.sign_in()

        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertFalse(second.data["created"])
        self.assertEqual(first.data["user"]["id"], second.data["user"]["id"])
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(SocialAccount.objects.count(), 1)

    def test_sign_in_links_to_existing_password_account_by_email(self):
        existing = User.objects.create_user(
            email="social@example.com",
            phone="01039811349",
            password="StrongPassword123!",
        )

        res = self.sign_in()

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(res.data["created"])
        self.assertTrue(res.data["requires_phone"])
        self.assertEqual(User.objects.count(), 1)

        existing.refresh_from_db()
        self.assertEqual(str(existing.id), res.data["user"]["id"])
        self.assertEqual(existing.status, UserStatus.ACTIVE)
        self.assertIsNotNone(existing.email_verified_at)
        self.assertTrue(existing.check_password("StrongPassword123!"))
        self.assertEqual(existing.social_accounts.count(), 1)

    def test_email_is_matched_case_insensitively(self):
        User.objects.create_user(
            email="social@example.com",
            phone="01039811349",
            password="StrongPassword123!",
        )

        res = self.sign_in(email="Social@Example.com")

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(User.objects.count(), 1)

    def test_unverified_google_email_is_rejected(self):
        res = self.sign_in(email_verified=False)

        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data["error"]["code"], "SOCIAL_AUTH_FAILED")
        self.assertFalse(User.objects.exists())

    def test_invalid_token_is_rejected(self):
        with patch(VERIFY_TARGET, side_effect=ValueError("Token expired")):
            res = self.client.post(self.url, {"token": "tampered"}, format="json")

        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data["error"]["code"], "SOCIAL_AUTH_FAILED")
        self.assertFalse(User.objects.exists())

    def test_missing_token_is_rejected(self):
        res = self.client.post(self.url, {}, format="json")

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_blocked_user_cannot_sign_in(self):
        User.objects.create_user(
            email="social@example.com",
            phone="01039811349",
            password="StrongPassword123!",
            status=UserStatus.BLOCKED,
        )

        res = self.sign_in()

        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data["error"]["code"], "SOCIAL_AUTH_FAILED")
        self.assertFalse(SocialAccount.objects.exists())

    def test_several_social_users_can_coexist_without_a_phone(self):
        self.sign_in()
        self.sign_in(sub="google-sub-456", email="other@example.com")

        self.assertEqual(User.objects.filter(phone__isnull=True).count(), 2)

    def test_unknown_provider_is_rejected(self):
        res = self.client.post(
            reverse("auth:social_auth", kwargs={"provider": "facebook"}),
            {"token": "any"},
            format="json",
        )

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["error"]["code"], "PROVIDER_NOT_CONFIGURED")

    @override_settings(SOCIAL_AUTH_PROVIDERS=GOOGLE_DISABLED)
    def test_provider_without_credentials_is_rejected(self):
        res = self.sign_in()

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["error"]["code"], "PROVIDER_NOT_CONFIGURED")


class SocialProvidersAPITests(APITestCase):
    def setUp(self):
        self.url = reverse("auth:social_providers")

    @override_settings(SOCIAL_AUTH_PROVIDERS=GOOGLE_ENABLED)
    def test_configured_provider_is_listed(self):
        res = self.client.get(self.url)

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["providers"], ["google"])

    @override_settings(SOCIAL_AUTH_PROVIDERS=GOOGLE_DISABLED)
    def test_unconfigured_provider_is_hidden(self):
        res = self.client.get(self.url)

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["providers"], [])
