from django.test import TestCase
from django.contrib.auth import authenticate
from apps.accounts.models import User, UserStatus


class EmailOrPhoneBackendTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="ahmed@example.com",
            phone="+201039811349",
            password="StrongPassword123!",
            status=UserStatus.ACTIVE,
        )

    def test_authenticate_with_email(self):
        authenticated_user = authenticate(
            identifier="ahmed@example.com",
            password="StrongPassword123!",
        )
        self.assertEqual(authenticated_user, self.user)

    def test_authenticate_with_email_case_insensitive(self):
        authenticated_user = authenticate(
            identifier="AHMED@EXAMPLE.COM",
            password="StrongPassword123!",
        )
        self.assertEqual(authenticated_user, self.user)

    def test_authenticate_with_canonical_phone(self):
        authenticated_user = authenticate(
            identifier="+201039811349",
            password="StrongPassword123!",
        )
        self.assertEqual(authenticated_user, self.user)

    def test_authenticate_with_local_phone_format(self):
        authenticated_user = authenticate(
            identifier="01039811349",
            password="StrongPassword123!",
        )
        self.assertEqual(authenticated_user, self.user)

    def test_authenticate_fails_with_wrong_password(self):
        authenticated_user = authenticate(
            identifier="ahmed@example.com",
            password="WrongPassword!",
        )
        self.assertIsNone(authenticated_user)

    def test_authenticate_fails_with_unknown_identifier(self):
        authenticated_user = authenticate(
            identifier="unknown@example.com",
            password="StrongPassword123!",
        )
        self.assertIsNone(authenticated_user)
