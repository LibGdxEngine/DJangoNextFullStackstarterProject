from rest_framework import serializers
from apps.accounts.models import User
from apps.accounts.phone import normalize_phone


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "phone",
            "first_name",
            "last_name",
            "avatar_url",
            "bio",
            "status",
            "phone_verified_at",
            "email_verified_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "email",
            "phone",
            "status",
            "phone_verified_at",
            "email_verified_at",
            "created_at",
            "updated_at",
        ]


class PhoneChangeInitiateSerializer(serializers.Serializer):
    new_phone = serializers.CharField(max_length=30)

    def validate_new_phone(self, value):
        try:
            return normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))


class PhoneChangeConfirmSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    code = serializers.CharField(max_length=10)


class EmailChangeSerializer(serializers.Serializer):
    new_email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class AccountDeletionInitiateSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True)
