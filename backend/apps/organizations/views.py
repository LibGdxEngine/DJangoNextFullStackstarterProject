from rest_framework import viewsets, permissions
from .models import Organization
from .serializers import OrganizationSerializer

class OrganizationViewSet(viewsets.ModelViewSet):
    """
    ViewSet for viewing and editing organizations.
    Authenticated users can view organizations where they hold active membership.
    """
    serializer_class = OrganizationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return Organization.objects.all()
        return Organization.objects.filter(memberships__user=user)

    def perform_create(self, serializer):
        org = serializer.save()
        # Automatically make creator the OWNER
        from .models import OrganizationMember
        OrganizationMember.objects.create(
            organization=org,
            user=self.request.user,
            role=OrganizationMember.Role.OWNER
        )
