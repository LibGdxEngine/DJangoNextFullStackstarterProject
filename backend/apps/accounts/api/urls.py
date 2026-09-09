from django.urls import path
from apps.accounts.api.views.auth import SessionTokenRefreshView
from apps.accounts.api.views import (
    SignupView,
    LoginView,
    LogoutView,
    PasswordForgotView,
    PasswordResetVerifyView,
    PasswordResetConfirmView,
    PasswordChangeView,
    VerificationConfirmView,
    VerificationResendView,
    UserProfileView,
    PhoneChangeInitiateView,
    PhoneChangeConfirmView,
    EmailChangeView,
    SocialAuthView,
    SocialProvidersView,
)

app_name = "auth"

urlpatterns = [
    # Registration & Login
    path("signup/", SignupView.as_view(), name="signup"),
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("token/refresh/", SessionTokenRefreshView.as_view(), name="token_refresh"),

    # Social Sign-In
    path("social/providers/", SocialProvidersView.as_view(), name="social_providers"),
    path("social/<str:provider>/", SocialAuthView.as_view(), name="social_auth"),

    # OTP Verification
    path("verification/confirm/", VerificationConfirmView.as_view(), name="verification_confirm"),
    path("verification/resend/", VerificationResendView.as_view(), name="verification_resend"),

    # Password Recovery & Change
    path("password/forgot/", PasswordForgotView.as_view(), name="password_forgot"),
    path("password/reset/verify/", PasswordResetVerifyView.as_view(), name="password_reset_verify"),
    path("password/reset/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("password/change/", PasswordChangeView.as_view(), name="password_change"),

    # Phone & Email Updates
    path("phone/change/", PhoneChangeInitiateView.as_view(), name="phone_change_initiate"),
    path("phone/change/confirm/", PhoneChangeConfirmView.as_view(), name="phone_change_confirm"),
    path("email/change/", EmailChangeView.as_view(), name="email_change"),

    # Profile & Deletion
    path("me/", UserProfileView.as_view(), name="me"),
]
