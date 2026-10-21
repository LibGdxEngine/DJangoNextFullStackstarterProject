from rest_framework import viewsets, permissions
from .models import Organization, OrganizationMember
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.db.models.deletion import ProtectedError
from .serializers import OrganizationSerializer

class OrganizationViewSet(viewsets.ModelViewSet):
    """
    ViewSet for viewing and editing organizations.
    Authenticated users can view organizations where they hold active membership.
    """
    serializer_class = OrganizationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Organization.objects.none()
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

    def _require_admin(self, organization):
        if not self.request.user.is_superuser and not OrganizationMember.objects.filter(organization=organization, user=self.request.user, role__in=['OWNER', 'ADMIN']).exists():
            raise PermissionDenied('Only organization owners and admins may change the academy.')

    def perform_update(self, serializer):
        self._require_admin(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_admin(instance)
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError('This academy has retained records. Deactivate it instead of deleting it.')
