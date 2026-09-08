from rest_framework import serializers
from .models import AuditLog

class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(source='actor.email', read_only=True, default="System")

    class Meta:
        model = AuditLog
        fields = [
            'id',
            'actor_email',
            'action',
            'resource_type',
            'resource_id',
            'metadata',
            'ip_address',
            'created_at',
        ]
        read_only_fields = fields
