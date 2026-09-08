from rest_framework import serializers


class VerificationConfirmSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    code = serializers.CharField(max_length=10)


class VerificationResendSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()


class VerificationChallengeResponseSerializer(serializers.Serializer):
    verification_required = serializers.BooleanField(default=True)
    challenge_id = serializers.UUIDField()
    destination = serializers.CharField()
    expires_in = serializers.IntegerField(default=300)
