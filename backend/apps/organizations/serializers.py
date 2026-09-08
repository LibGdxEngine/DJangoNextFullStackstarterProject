from rest_framework import serializers
from .models import Organization, OrganizationMember

class OrganizationMemberSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = OrganizationMember
        fields = ['id', 'user', 'username', 'email', 'role', 'created_at']
        read_only_fields = ['id', 'created_at']


class OrganizationSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(source='memberships.count', read_only=True)

    class Meta:
        model = Organization
        fields = ['id', 'name', 'slug', 'is_active', 'member_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
