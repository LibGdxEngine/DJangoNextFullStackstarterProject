from rest_framework import serializers
from apps.accounts.phone import normalize_phone


class CustomTokenObtainPairSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        from django.core.exceptions import ValidationError
        from rest_framework_simplejwt.exceptions import AuthenticationFailed
        from apps.accounts.services.authentication import (
            authenticate_user, issue_tokens_for_user, PhoneVerificationRequiredError,
        )
        try:
            user = authenticate_user(**attrs, request=self.context.get("request"))
            return issue_tokens_for_user(user)
        except (ValidationError, PhoneVerificationRequiredError) as exc:
            raise AuthenticationFailed(str(exc)) from exc


class SessionTokenRefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField()
    access = serializers.CharField(read_only=True)

    def validate(self, attrs):
        from apps.accounts.services.authentication import rotate_refresh_token
        return rotate_refresh_token(attrs["refresh"])


class SessionTokenVerifySerializer(serializers.Serializer):
    token = serializers.CharField(write_only=True)

    def validate(self, attrs):
        from apps.accounts.authentication import VersionedJWTAuthentication
        authentication = VersionedJWTAuthentication()
        token = authentication.get_validated_token(attrs["token"])
        authentication.get_user(token)
        return {}


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
