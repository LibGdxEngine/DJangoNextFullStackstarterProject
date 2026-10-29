from rest_framework import serializers

from apps.organizations.models import Organization

from .models import AgentArtifact, AgentRole, AgentRun, AgentRunEvent, BrowserProfile, TaskTemplate


class AgentRoleSerializer(serializers.ModelSerializer):
    organization = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.all(),
        help_text='Owner of a custom role; null for built-in roles. Cannot be changed.')
    skills = serializers.ListField(child=serializers.CharField(max_length=40), max_length=8, required=False)
    is_builtin = serializers.BooleanField(read_only=True)
    active_runs = serializers.IntegerField(
        read_only=True, default=0, help_text="Runs of this role still queued or running in the caller's organizations.")

    class Meta:
        model = AgentRole
        fields = [
            'id', 'organization', 'slug', 'name', 'title', 'summary', 'skills', 'avatar', 'tint',
            'instructions', 'is_builtin', 'active_runs', 'created_at',
        ]
        read_only_fields = ['id', 'slug', 'avatar', 'tint', 'is_builtin', 'active_runs', 'created_at']

    def validate_organization(self, organization):
        if self.instance is not None and organization != self.instance.organization:
            raise serializers.ValidationError('A role cannot move to another organization.')
        return organization


class AgentRoleSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentRole
        fields = ['id', 'name', 'title', 'avatar', 'tint']
        read_only_fields = fields


class TaskTemplateSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model = TaskTemplate
        fields = [
            'id', 'organization', 'category', 'category_label', 'title', 'description', 'prompt',
            'image', 'role',
        ]
        read_only_fields = fields


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


CONTROL_STATES = [('agent', 'Agent'), ('waiting', 'Waiting for the agent to pause'), ('user', 'User')]
CONTROL_ACTIONS = [('take', 'Take'), ('release', 'Release')]
INPUT_TYPES = [('click', 'Click'), ('move', 'Move'), ('wheel', 'Wheel'), ('text', 'Text'), ('key', 'Key')]


class AgentLiveFrameSerializer(serializers.Serializer):
    seq = serializers.IntegerField()
    image = serializers.CharField(help_text='Base64-encoded JPEG of the browser viewport.')
    url = serializers.CharField(allow_blank=True)
    captured_at = serializers.DateTimeField()
    live = serializers.BooleanField(help_text='False once the run has closed its browser.')


class AgentControlStateSerializer(serializers.Serializer):
    control = serializers.ChoiceField(
        choices=CONTROL_STATES,
        help_text='Who drives the browser: the agent, the user, or the user waiting for the agent to pause.')
    help = serializers.CharField(allow_blank=True, help_text='Why the agent asked the user to take over, if it did.')


class AgentLiveSerializer(serializers.Serializer):
    frame = AgentLiveFrameSerializer(allow_null=True, help_text='Null when there is no newer frame.')
    state = AgentControlStateSerializer()


class AgentControlRequestSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=CONTROL_ACTIONS)


class AgentInputEventSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=INPUT_TYPES)
    x = serializers.FloatField(min_value=0, max_value=1, required=False)
    y = serializers.FloatField(min_value=0, max_value=1, required=False)
    count = serializers.IntegerField(min_value=1, max_value=3, required=False)
    dy = serializers.FloatField(min_value=-5000, max_value=5000, required=False)
    text = serializers.CharField(max_length=2000, required=False, trim_whitespace=False)
    key = serializers.CharField(max_length=20, required=False)
    modifiers = serializers.IntegerField(min_value=0, max_value=15, required=False)

    def validate(self, attrs):
        kind = attrs['type']
        if kind in ('click', 'move', 'wheel') and ('x' not in attrs or 'y' not in attrs):
            raise serializers.ValidationError('Pointer events need x and y.')
        if kind == 'text' and not attrs.get('text'):
            raise serializers.ValidationError('Text events need text.')
        if kind == 'key':
            from .live import SPECIAL_KEYS
            key = attrs.get('key', '')
            shortcut = len(key) == 1 and key.isalpha() and attrs.get('modifiers', 0) & 6
            if key not in SPECIAL_KEYS and not shortcut:
                raise serializers.ValidationError('Unsupported key.')
        return attrs


class AgentInputSerializer(serializers.Serializer):
    events = AgentInputEventSerializer(many=True, max_length=100, min_length=1)


class AgentAnswerSerializer(serializers.Serializer):
    answer = serializers.CharField(max_length=4000, help_text="Reply to the run's question; one of its options or free text.")


class AgentRunSerializer(serializers.ModelSerializer):
    organization = serializers.PrimaryKeyRelatedField(queryset=Organization.objects.all())
    profile = serializers.PrimaryKeyRelatedField(
        queryset=BrowserProfile.objects.all(), required=False, allow_null=True)
    role = serializers.PrimaryKeyRelatedField(
        queryset=AgentRole.objects.all(), required=False, allow_null=True,
        help_text='The role the agent works as; a built-in role or one of the organization.')
    role_detail = AgentRoleSummarySerializer(source='role', read_only=True, allow_null=True)
    task = serializers.CharField(max_length=8000)

    class Meta:
        model = AgentRun
        fields = [
            'id', 'organization', 'profile', 'role', 'role_detail', 'task', 'status', 'question', 'final_text',
            'error', 'usage', 'cancel_requested', 'recoveries', 'created_at', 'started_at', 'finished_at',
        ]
        read_only_fields = [
            'id', 'status', 'question', 'final_text', 'error', 'usage', 'cancel_requested', 'recoveries',
            'created_at', 'started_at', 'finished_at',
        ]

    def validate(self, attrs):
        profile = attrs.get('profile')
        if profile and profile.organization_id != attrs['organization'].id:
            raise serializers.ValidationError({'profile': 'Profile belongs to another organization.'})
        role = attrs.get('role')
        if role and not role.is_builtin and role.organization_id != attrs['organization'].id:
            raise serializers.ValidationError({'role': 'Role belongs to another organization.'})
        return attrs
