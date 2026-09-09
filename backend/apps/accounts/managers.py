from django.contrib.auth.base_user import BaseUserManager
from django.utils import timezone
from apps.accounts.phone import normalize_phone


class CustomUserManager(BaseUserManager):
    """
    Custom user manager where email is the primary unique identifier for auth
    and phone is required, normalized to E.164. No username field is used.
    """

    def create_user(self, email, phone, password=None, **extra_fields):
        if not email:
            raise ValueError("The Email field must be set.")
        if not phone:
            raise ValueError("The Phone field must be set.")

        email = self.normalize_email(email).strip().lower()
        phone = normalize_phone(phone)

        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)

        user = self.model(
            email=email,
            phone=phone,
            **extra_fields,
        )
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()

        user.save(using=self._db)
        return user

    def create_social_user(self, email, **extra_fields):
        """
        Creates a user from an already-verified social identity: no phone, no usable password.
        """
        if not email:
            raise ValueError("The Email field must be set.")

        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)

        user = self.model(
            email=self.normalize_email(email).strip().lower(),
            phone=None,
            **extra_fields,
        )
        user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, phone, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("status", "active")
        extra_fields.setdefault("phone_verified_at", timezone.now())

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email, phone, password, **extra_fields)
