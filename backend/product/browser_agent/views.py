from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.organizations.models import Organization

from .models import AgentRun
from .serializers import AgentArtifactSerializer, AgentRunEventSerializer, AgentRunSerializer
from .services import run_directory
from .tasks import run_agent


class AgentRunViewSet(mixins.CreateModelMixin, mixins.ListModelMixin,
                      mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Create, watch and cancel browser-agent runs, scoped to the caller's organizations."""
    serializer_class = AgentRunSerializer
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'agent_runs'

    def get_throttles(self):
        # Only run creation is throttled; polling and downloads are cheap reads.
        return super().get_throttles() if self.action == 'create' else []

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return AgentRun.objects.none()
        qs = AgentRun.objects.filter(organization__memberships__user=self.request.user)
        organization = self.request.query_params.get('organization')
        return qs.filter(organization_id=organization) if organization else qs

    def perform_create(self, serializer):
        organization: Organization = serializer.validated_data['organization']
        if not organization.memberships.filter(user=self.request.user).exists():
            raise PermissionDenied('You are not a member of this organization.')
        active = AgentRun.objects.filter(organization=organization, status__in=AgentRun.ACTIVE).count()
        if active >= settings.AGENT_MAX_ACTIVE_RUNS_PER_ORG:
            raise ValidationError({'organization': 'Too many runs are already active; wait for one to finish.'})
        run = serializer.save(created_by=self.request.user)
        run_agent.delay_on_commit(str(run.id))

    @action(detail=True, methods=['get'])
    def events(self, request, pk=None):
        run = self.get_object()
        after = request.query_params.get('after')
        events = run.events.all()
        if after is not None:
            try:
                events = events.filter(seq__gte=int(after))
            except ValueError:
                raise ValidationError({'after': 'Must be an integer.'})
        return Response(AgentRunEventSerializer(events[:500], many=True).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        run = self.get_object()
        if run.status not in AgentRun.ACTIVE:
            raise ValidationError({'status': 'Run has already finished.'})
        run.cancel_requested = True
        run.save(update_fields=['cancel_requested', 'updated_at'])
        return Response(self.get_serializer(run).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['get'])
    def artifacts(self, request, pk=None):
        run = self.get_object()
        return Response(AgentArtifactSerializer(run.artifacts.all(), many=True).data)

    @action(detail=True, methods=['get'], url_path=r'artifacts/(?P<artifact_id>[0-9a-f-]+)/download')
    def download(self, request, pk=None, artifact_id=None):
        run = self.get_object()
        artifact = run.artifacts.filter(pk=artifact_id).first()
        if artifact is None:
            raise Http404
        root = run_directory(run).resolve()
        path = (root / artifact.path).resolve()
        if root not in path.parents or not path.is_file():
            raise Http404
        return FileResponse(open(path, 'rb'), as_attachment=True, filename=path.name)
