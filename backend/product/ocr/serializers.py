from rest_framework import serializers

from .models import OCRAPIKey, OCRJob
from .security import validate_webhook_url


class OCRKeyCreateSerializer(serializers.Serializer):
    organization_id = serializers.UUIDField()
    name = serializers.CharField(max_length=100)


class OCRKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = OCRAPIKey
        fields = ["id", "organization_id", "name", "created_at", "expires_at", "revoked_at"]
        read_only_fields = fields


class OCRKeyCreatedSerializer(OCRKeySerializer):
    api_key = serializers.CharField(read_only=True)
    webhook_signing_secret = serializers.CharField(read_only=True)

    class Meta(OCRKeySerializer.Meta):
        fields = OCRKeySerializer.Meta.fields + ["api_key", "webhook_signing_secret"]


class OCRSubmitSerializer(serializers.Serializer):
    file = serializers.FileField(allow_empty_file=False, write_only=True)
    webhook_url = serializers.URLField(max_length=2048)

    def validate_webhook_url(self, value):
        try:
            return validate_webhook_url(value)
        except ValueError:
            raise serializers.ValidationError("Use a public HTTPS webhook URL.") from None


class OCRJobSerializer(serializers.ModelSerializer):
    result_url = serializers.SerializerMethodField()
    webhook_status = serializers.SerializerMethodField()

    class Meta:
        model = OCRJob
        fields = ["id", "status", "created_at", "finished_at", "result_expires_at", "error_code", "result_url", "webhook_status"]
        read_only_fields = fields

    def get_result_url(self, obj) -> str:
        return f"/api/v1/ocr/jobs/{obj.id}/result/"

    def get_webhook_status(self, obj) -> str:
        try:
            return obj.webhook_event.status
        except OCRJob.webhook_event.RelatedObjectDoesNotExist:
            return "pending"


class OCRResultSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    result = serializers.JSONField()
