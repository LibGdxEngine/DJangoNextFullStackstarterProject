from django.test import TestCase
from django.db import IntegrityError
from apps.accounts.models import User, UserStatus


class UserManagerTests(TestCase):
    def test_create_user(self):
        user = User.objects.create_user(
            email="test@example.com",
            phone="01039811349",
            password="SecurePassword123!",
        )
        self.assertEqual(user.email, "test@example.com")
        self.assertEqual(user.phone, "+201039811349")
        self.assertEqual(user.status, UserStatus.PENDING)
        self.assertIsNone(user.phone_verified_at)
        self.assertTrue(user.check_password("SecurePassword123!"))
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertEqual(user.token_version, 1)

    def test_create_superuser(self):
        admin = User.objects.create_superuser(
            email="admin@example.com",
            phone="+201011112222",
            password="AdminPassword123!",
        )
        self.assertEqual(admin.email, "admin@example.com")
        self.assertEqual(admin.phone, "+201011112222")
        self.assertEqual(admin.status, UserStatus.ACTIVE)
        self.assertIsNotNone(admin.phone_verified_at)
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_superuser)

    def test_email_case_insensitive_uniqueness(self):
        User.objects.create_user(
            email="ahmed@example.com",
            phone="+201039811349",
            password="Password1!",
        )
        with self.assertRaises(IntegrityError):
            User.objects.create_user(
                email="AHMED@example.com",
                phone="+201099998888",
                password="Password2!",
            )

    def test_phone_uniqueness(self):
        User.objects.create_user(
            email="user1@example.com",
            phone="+201039811349",
            password="Password1!",
        )
        with self.assertRaises(IntegrityError):
            User.objects.create_user(
                email="user2@example.com",
                phone="+201039811349",
                password="Password2!",
            )
