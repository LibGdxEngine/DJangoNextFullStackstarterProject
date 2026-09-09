from rest_framework import serializers


class SocialAuthSerializer(serializers.Serializer):
    token = serializers.CharField(write_only=True, trim_whitespace=True)
