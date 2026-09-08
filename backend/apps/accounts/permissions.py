from rest_framework.permissions import BasePermission
from apps.accounts.models import UserStatus


class IsPhoneVerified(BasePermission):
    """
    Allows access only to authenticated users with verified phone number.
    """
    message = "Phone verification is required to perform this action."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.phone_verified_at is not None
        )


class IsActiveAccount(BasePermission):
    """
    Allows access only to authenticated users with active account status.
    """
    message = "Account is not active."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.status == UserStatus.ACTIVE
        )
