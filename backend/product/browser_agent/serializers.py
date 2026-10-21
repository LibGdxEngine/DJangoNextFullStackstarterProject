from rest_framework import serializers

from apps.organizations.models import Organization

from .models import AgentArtifact, AgentRun, AgentRunEvent, BrowserProfile


class AgentArtifactSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentArtifact
        fields = ['id', 'kind', 'path', 'size', 'created_at']
        read_only_fields = fields


class AgentRunEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentRunEvent
        fields = ['seq', 'kind', 'payload', 'created_at']
        read_only_fields = fields


class AgentLiveFrameSerializer(serializers.Serializer):
    seq = serializers.IntegerField()
    image = serializers.CharField(help_text='Base64-encoded JPEG of the browser viewport.')
    url = serializers.CharField(allow_blank=True)
    captured_at = serializers.DateTimeField()
    live = serializers.BooleanField(help_text='False once the run has closed its browser.')


class AgentRunSerializer(serializers.ModelSerializer):
    organization = serializers.PrimaryKeyRelatedField(queryset=Organization.objects.all())
    profile = serializers.PrimaryKeyRelatedField(
        queryset=BrowserProfile.objects.all(), required=False, allow_null=True)
    task = serializers.CharField(max_length=8000)

    class Meta:
        model = AgentRun
        fields = [
            'id', 'organization', 'profile', 'task', 'status', 'final_text', 'error', 'usage',
            'cancel_requested', 'created_at', 'started_at', 'finished_at',
        ]
        read_only_fields = [
            'id', 'status', 'final_text', 'error', 'usage', 'cancel_requested',
            'created_at', 'started_at', 'finished_at',
        ]

    def validate(self, attrs):
        profile = attrs.get('profile')
        if profile and profile.organization_id != attrs['organization'].id:
            raise serializers.ValidationError({'profile': 'Profile belongs to another organization.'})
        return attrs
