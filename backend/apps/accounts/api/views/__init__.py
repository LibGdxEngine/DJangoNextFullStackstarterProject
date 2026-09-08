from .auth import (
    SignupView,
    LoginView,
    LogoutView,
    PasswordForgotView,
    PasswordResetVerifyView,
    PasswordResetConfirmView,
    PasswordChangeView,
)
from .verification import (
    VerificationConfirmView,
    VerificationResendView,
)
from .profile import (
    UserProfileView,
    PhoneChangeInitiateView,
    PhoneChangeConfirmView,
    EmailChangeView,
)

__all__ = [
    "SignupView",
    "LoginView",
    "LogoutView",
    "PasswordForgotView",
    "PasswordResetVerifyView",
    "PasswordResetConfirmView",
    "PasswordChangeView",
    "VerificationConfirmView",
    "VerificationResendView",
    "UserProfileView",
    "PhoneChangeInitiateView",
    "PhoneChangeConfirmView",
    "EmailChangeView",
]
