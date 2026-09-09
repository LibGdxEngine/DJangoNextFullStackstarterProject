from django.contrib.auth.models import update_last_login
from django.core.exceptions import ValidationError
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from apps.accounts.phone import normalize_phone
from apps.accounts.services.authentication import (
    PhoneVerificationRequiredError, SessionRefreshToken, authenticate_user,
    issue_tokens_for_user, rotate_refresh_token,
)


class SessionTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        if "sid" not in SessionRefreshToken(attrs["refresh"]):
            return super().validate(attrs)
        return rotate_refresh_token(attrs["refresh"])


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Accepts 'identifier' (email or phone) + password.
    Issues the same revocable session family as the primary login endpoint.
    """
    username_field = "identifier"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["identifier"] = serializers.CharField(required=True)
        if "username" in self.fields:
            del self.fields["username"]

    def validate(self, attrs):
        try:
            self.user = authenticate_user(
                identifier=attrs["identifier"], password=attrs["password"],
                request=self.context.get("request"),
            )
            tokens = issue_tokens_for_user(self.user)
        except (ValidationError, PhoneVerificationRequiredError) as exc:
            raise AuthenticationFailed("Account is not eligible for login.") from exc
        if api_settings.UPDATE_LAST_LOGIN:
            update_last_login(None, self.user)
        return {"access": tokens["access"], "refresh": tokens["refresh"]}


class SignupSerializer(serializers.Serializer):
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=30)
    password = serializers.CharField(write_only=True, min_length=8)
    first_name = serializers.CharField(required=False, allow_blank=True, default="")
    last_name = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_phone(self, value):
        try:
            return normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))


class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField(write_only=True)


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class PasswordForgotSerializer(serializers.Serializer):
    identifier = serializers.CharField()


class PasswordResetVerifySerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    code = serializers.CharField(max_length=10)


class PasswordResetConfirmSerializer(serializers.Serializer):
    reset_token = serializers.CharField()
    new_password = serializers.CharField(min_length=8, write_only=True)


class PasswordChangeSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(min_length=8, write_only=True)
