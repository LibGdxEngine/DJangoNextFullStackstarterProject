from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from apps.accounts.phone import normalize_phone


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Accepts 'identifier' (email or phone) + password.
    Embeds token_version, email, phone, and status into JWT claims.
    """
    username_field = "identifier"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["identifier"] = serializers.CharField(required=True)
        if "username" in self.fields:
            del self.fields["username"]

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["token_version"] = user.token_version
        token["email"] = user.email
        token["phone"] = user.phone
        token["status"] = user.status
        return token

    def validate(self, attrs):
        # Allow standard SimpleJWT flow with custom identifier
        attrs["username"] = attrs.get("identifier")
        return super().validate(attrs)


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
