from django.db import transaction
from rest_framework import permissions
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from apps.organizations.models import Organization, OrganizationMember
from . import models as m, serializers as s
from .access import Access
from .validators import validate_timezone
from .services.common import settings_for


def workspace_data(access):
    settings = settings_for(access.organization)
    return {"organization": access.organization.id, "name": access.organization.name, "logo_url": settings.logo_url, "language": settings.language, "timezone": settings.timezone, "workspaces": access.workspaces, "selected_workspace": access.workspace, "capabilities": sorted(access.capabilities)}


class WorkspaceListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(tags=["academy"], responses=s.WorkspaceSerializer(many=True))
    def get(self, request):
        user = request.user
        ids = set(OrganizationMember.objects.filter(user=user, role__in=["OWNER", "ADMIN"]).values_list("organization_id", flat=True))
        for model in (m.StaffRole, m.Teacher, m.FamilyContact, m.Student):
            ids.update(model.objects.filter(user=user).values_list("organization_id", flat=True))
        result = []
        for org in Organization.objects.filter(pk__in=ids, is_active=True):
            try:
                result.append(workspace_data(Access(user, org)))
            except PermissionDenied:
                continue
        return Response(result)

    @extend_schema(tags=["academy"], request=s.AcademyCreateSerializer, responses={201: s.WorkspaceSerializer})
    def post(self, request):
        if not request.user.is_active or request.user.status != "active":
            raise PermissionDenied("An active account is required.")
        serializer = s.AcademyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        validate_timezone(data["timezone"])
        with transaction.atomic():
            if Organization.objects.filter(slug=data["slug"]).exists():
                raise ValidationError({"slug": "An academy with this slug already exists."})
            org = Organization.objects.create(name=data["name"], slug=data["slug"])
            OrganizationMember.objects.create(organization=org, user=request.user, role="OWNER")
            m.AcademySettings.objects.create(organization=org, language=data["language"], timezone=data["timezone"])
            return Response(workspace_data(Access(request.user, org)), status=201)
