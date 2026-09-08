from rest_framework import serializers
from .models import Organization, OrganizationMember

class OrganizationMemberSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source='user.email', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)

    class Meta:
        model = OrganizationMember
        fields = ['id', 'user', 'email', 'phone', 'role', 'created_at']
        read_only_fields = ['id', 'created_at']


class OrganizationSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(source='memberships.count', read_only=True)

    class Meta:
        model = Organization
        fields = ['id', 'name', 'slug', 'is_active', 'member_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
