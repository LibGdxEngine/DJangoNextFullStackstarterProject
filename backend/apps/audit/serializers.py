from rest_framework import serializers
from .models import AuditLog

class AuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source='actor.username', read_only=True, default="System")

    class Meta:
        model = AuditLog
        fields = [
            'id',
            'actor_username',
            'action',
            'resource_type',
            'resource_id',
            'metadata',
            'ip_address',
            'created_at',
        ]
        read_only_fields = fields
