from unittest.mock import patch
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from apps.accounts.models import User, UserStatus, VerificationChallenge
from apps.accounts.services.verification import compute_code_digest


class AuthAPITests(APITestCase):
    @patch("apps.messaging.tasks.send_verification_message.delay")
    def test_full_signup_and_verification_flow(self, mock_send):
        # 1. Signup
        signup_url = reverse("auth:signup")
        signup_payload = {
            "email": "newuser@example.com",
            "phone": "01039811349",
            "password": "StrongPassword123!",
            "first_name": "Ahmed",
            "last_name": "Test",
        }
        res = self.client.post(signup_url, signup_payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res.data.get("verification_required"))
        self.assertIn("challenge_id", res.data)
        self.assertNotIn("code", res.data)  # Plain code is never leaked!

        challenge_id = res.data["challenge_id"]

        # Ensure user is pending and unverified
        user = User.objects.get(email="newuser@example.com")
        self.assertEqual(user.status, UserStatus.PENDING)
        self.assertIsNone(user.phone_verified_at)
        self.assertEqual(user.phone, "+201039811349")

        # 2. Login attempt before verification fails with PHONE_VERIFICATION_REQUIRED
        login_url = reverse("auth:login")
        login_res = self.client.post(
            login_url,
            {"identifier": "newuser@example.com", "password": "StrongPassword123!"},
            format="json",
        )
        self.assertEqual(login_res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(login_res.data["error"]["code"], "PHONE_VERIFICATION_REQUIRED")
        self.assertEqual(login_res.data["error"]["context"]["email"], "newuser@example.com")
        self.assertNotEqual(login_res.data["error"]["context"]["phone"], user.phone)
        self.assertEqual(login_res.data["error"]["fields"], {})

        # 3. Confirm verification
        # For testing, compute digest for known code "123456"
        challenge = VerificationChallenge.objects.get(id=challenge_id)
        challenge.code_digest = compute_code_digest("123456")
        challenge.save()

        confirm_url = reverse("auth:verification_confirm")
        confirm_res = self.client.post(
            confirm_url,
            {"challenge_id": challenge_id, "code": "123456"},
            format="json",
        )
        self.assertEqual(confirm_res.status_code, status.HTTP_200_OK)
        self.assertIn("access", confirm_res.data)
        self.assertIn("refresh", confirm_res.data)

        # User is now active and phone is verified
        user.refresh_from_db()
        self.assertEqual(user.status, UserStatus.ACTIVE)
        self.assertIsNotNone(user.phone_verified_at)

        # 4. Login with email
        login_email_res = self.client.post(
            login_url,
            {"identifier": "newuser@example.com", "password": "StrongPassword123!"},
            format="json",
        )
        self.assertEqual(login_email_res.status_code, status.HTTP_200_OK)
        self.assertIn("access", login_email_res.data)

        # 5. Login with phone
        login_phone_res = self.client.post(
            login_url,
            {"identifier": "+201039811349", "password": "StrongPassword123!"},
            format="json",
        )
        self.assertEqual(login_phone_res.status_code, status.HTTP_200_OK)
        self.assertIn("access", login_phone_res.data)

    @patch("apps.messaging.tasks.send_verification_message.delay")
    def test_password_recovery_and_reset_flow(self, mock_send):
        user = User.objects.create_user(
            email="recover@example.com",
            phone="+201055556666",
            password="OldPassword123!",
            status=UserStatus.ACTIVE,
        )
        user.phone_verified_at = user.created_at
        user.save()

        # Step 1: Request forgot password
        forgot_url = reverse("auth:password_forgot")
        forgot_res = self.client.post(forgot_url, {"identifier": "recover@example.com"}, format="json")
        self.assertEqual(forgot_res.status_code, status.HTTP_200_OK)
        challenge_id = forgot_res.data.get("challenge_id")
        self.assertIsNotNone(challenge_id)

        # Step 2: Verify reset OTP
        challenge = VerificationChallenge.objects.get(id=challenge_id)
        challenge.code_digest = compute_code_digest("654321")
        challenge.save()

        verify_url = reverse("auth:password_reset_verify")
        verify_res = self.client.post(
            verify_url,
            {"challenge_id": challenge_id, "code": "654321"},
            format="json",
        )
        self.assertEqual(verify_res.status_code, status.HTTP_200_OK)
        reset_token = verify_res.data["reset_token"]

        # Step 3: Complete reset with new password
        reset_url = reverse("auth:password_reset_confirm")
        reset_res = self.client.post(
            reset_url,
            {"reset_token": reset_token, "new_password": "BrandNewPassword123!"},
            format="json",
        )
        self.assertEqual(reset_res.status_code, status.HTTP_200_OK)

        # Old password no longer works
        old_login = self.client.post(
            reverse("auth:login"),
            {"identifier": "recover@example.com", "password": "OldPassword123!"},
            format="json",
        )
        self.assertEqual(old_login.status_code, status.HTTP_401_UNAUTHORIZED)

        # New password works
        new_login = self.client.post(
            reverse("auth:login"),
            {"identifier": "recover@example.com", "password": "BrandNewPassword123!"},
            format="json",
        )
        self.assertEqual(new_login.status_code, status.HTTP_200_OK)

    @patch("apps.messaging.tasks.send_verification_message.delay")
    def test_phone_change_flow(self, mock_send):
        user = User.objects.create_user(
            email="phonechange@example.com",
            phone="+201011112222",
            password="Password123!",
            status=UserStatus.ACTIVE,
        )
        user.phone_verified_at = user.created_at
        user.save()

        self.client.force_authenticate(user=user)

        # Phase 1: Initiate phone change
        init_url = reverse("auth:phone_change_initiate")
        init_res = self.client.post(init_url, {"new_phone": "01099998888"}, format="json")
        self.assertEqual(init_res.status_code, status.HTTP_200_OK)
        challenge_id = init_res.data["challenge_id"]

        # User phone is NOT changed yet
        user.refresh_from_db()
        self.assertEqual(user.phone, "+201011112222")

        # Phase 2: Confirm new phone with OTP
        challenge = VerificationChallenge.objects.get(id=challenge_id)
        challenge.code_digest = compute_code_digest("999111")
        challenge.save()

        confirm_url = reverse("auth:phone_change_confirm")
        confirm_res = self.client.post(
            confirm_url,
            {"challenge_id": challenge_id, "code": "999111"},
            format="json",
        )
        self.assertEqual(confirm_res.status_code, status.HTTP_200_OK)

        user.refresh_from_db()
        self.assertEqual(user.phone, "+201099998888")
        self.assertEqual(user.token_version, 2)
