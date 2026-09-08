from django.contrib.auth.backends import ModelBackend
from apps.accounts.models import User
from apps.accounts.phone import normalize_phone


class EmailOrPhoneBackend(ModelBackend):
    """
    Authenticates a user via either email + password or phone + password.
    Accepts 'identifier' or 'username' parameter for drop-in compatibility.
    """

    def authenticate(
        self,
        request,
        username=None,
        password=None,
        **kwargs,
    ):
        identifier = kwargs.get("identifier") or username

        if not identifier or not password:
            return None

        identifier = str(identifier).strip()

        if "@" in identifier:
            user = (
                User.objects
                .filter(email__iexact=identifier)
                .first()
            )
        else:
            try:
                phone = normalize_phone(identifier)
            except ValueError:
                return None

            user = (
                User.objects
                .filter(phone=phone)
                .first()
            )

        if not user:
            return None

        if not user.check_password(password):
            return None

        if not self.user_can_authenticate(user):
            return None

        return user
