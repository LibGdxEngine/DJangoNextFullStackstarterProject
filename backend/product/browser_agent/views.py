import uuid

from django.conf import settings
from django.db.models import Count, F, Q
from django.http import FileResponse, Http404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.organizations.models import Organization

from .live import get_frame, get_state, push_input, release_control, request_control
from .models import AgentRole, AgentRun, TaskTemplate
from .serializers import (
    AgentAnswerSerializer, AgentArtifactSerializer, AgentControlRequestSerializer, AgentControlStateSerializer,
    AgentInputSerializer, AgentLiveSerializer, AgentRoleSerializer, AgentRunEventSerializer,
    AgentRunSerializer, TaskTemplateSerializer,
)
from .services import cancel_waiting_run, collect_artifacts, run_directory
from .tasks import run_agent


def require_member(user, organization: Organization):
    if not organization.memberships.filter(user=user).exists():
        raise PermissionDenied('You are not a member of this organization.')


def visible_organizations(request):
    """The caller's organizations, narrowed to ``?organization=`` when given."""
    organizations = Organization.objects.filter(memberships__user=request.user)
    organization = request.query_params.get('organization')
    return organizations.filter(pk=organization) if organization else organizations


def builtin_or_own(queryset, organizations):
    """Built-in rows plus the rows owned by ``organizations``."""
    return queryset.filter(Q(organization__isnull=True) | Q(organization__in=organizations))


@extend_schema(parameters=[OpenApiParameter(
    'organization', OpenApiTypes.UUID, description='Built-in roles plus the roles of this organization.')])
class AgentRoleViewSet(viewsets.ModelViewSet):
    """Roles the agent can work as: built-in ones, and custom ones an organization hires."""
    serializer_class = AgentRoleSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return AgentRole.objects.none()
        organizations = visible_organizations(self.request)
        active = Q(runs__status__in=AgentRun.ACTIVE, runs__organization__in=organizations)
        # Built-in roles first. Aggregating drops Meta.ordering, so it must be explicit anyway.
        return builtin_or_own(AgentRole.objects.all(), organizations).annotate(
            active_runs=Count('runs', filter=active, distinct=True),
        ).order_by(F('organization').asc(nulls_first=True), 'sort_order', 'created_at')

    def perform_create(self, serializer):
        require_member(self.request.user, serializer.validated_data['organization'])
        serializer.save(slug=f'custom-{uuid.uuid4().hex[:8]}')

    def perform_update(self, serializer):
        if serializer.instance.is_builtin:
            raise PermissionDenied('Built-in roles cannot be changed.')
        serializer.save()

    def perform_destroy(self, instance):
        if instance.is_builtin:
            raise PermissionDenied('Built-in roles cannot be removed.')
        instance.delete()


@extend_schema(parameters=[
    OpenApiParameter('organization', OpenApiTypes.UUID,
                     description='Built-in templates plus the templates of this organization.'),
    OpenApiParameter('category', str, enum=TaskTemplate.Category.values),
])
class TaskTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    """Ready-made requests for the task library. ``?search=`` matches title, description and prompt."""
    serializer_class = TaskTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [SearchFilter]
    search_fields = ['title', 'description', 'prompt']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return TaskTemplate.objects.none()
        qs = builtin_or_own(TaskTemplate.objects.all(), visible_organizations(self.request))
        category = self.request.query_params.get('category')
        return qs.filter(category=category) if category else qs


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
        qs = AgentRun.objects.filter(organization__memberships__user=self.request.user).select_related('role')
        organization = self.request.query_params.get('organization')
        return qs.filter(organization_id=organization) if organization else qs

    def perform_create(self, serializer):
        organization: Organization = serializer.validated_data['organization']
        require_member(self.request.user, organization)
        active = AgentRun.objects.filter(organization=organization, status__in=AgentRun.ACTIVE).count()
        if active >= settings.AGENT_MAX_ACTIVE_RUNS_PER_ORG:
            raise ValidationError({'organization': 'Too many runs are already active; wait for one to finish.'})
        run = serializer.save(created_by=self.request.user)
        run_agent.delay_on_commit(str(run.id))

    @extend_schema(
        parameters=[OpenApiParameter('after', int, description='Only events with seq >= this value.')],
        responses=AgentRunEventSerializer(many=True),
    )
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

    @extend_schema(request=None, responses={202: AgentRunSerializer})
    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        run = self.get_object()
        if run.status not in AgentRun.ACTIVE:
            raise ValidationError({'status': 'Run has already finished.'})
        run.cancel_requested = True
        run.save(update_fields=['cancel_requested', 'updated_at'])
        cancel_waiting_run(run)   # no worker holds a waiting run, so it ends here
        run.refresh_from_db()
        return Response(self.get_serializer(run).data, status=status.HTTP_202_ACCEPTED)

    @extend_schema(request=AgentAnswerSerializer, responses={202: AgentRunSerializer})
    @action(detail=True, methods=['post'])
    def answer(self, request, pk=None):
        """Answer the question a waiting run asked; the run is queued again and carries on."""
        run = self.get_object()
        serializer = AgentAnswerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        resumed = AgentRun.objects.filter(pk=run.pk, status=AgentRun.Status.WAITING, cancel_requested=False).update(
            status=AgentRun.Status.QUEUED, answer=serializer.validated_data['answer'], updated_at=timezone.now())
        if not resumed:
            raise ValidationError({'status': 'Run is not waiting for an answer.'})
        run_agent.delay_on_commit(str(run.id))
        run.refresh_from_db()
        return Response(self.get_serializer(run).data, status=status.HTTP_202_ACCEPTED)

    @extend_schema(
        parameters=[OpenApiParameter('after', int, description='Include the frame only if it is newer than this seq.')],
        responses=AgentLiveSerializer,
    )
    @action(detail=True, methods=['get'])
    def live(self, request, pk=None):
        """Latest frame of the run's browser and who is driving it, for watching it live."""
        run = self.get_object()
        frame = get_frame(run.id)
        try:
            after = int(request.query_params.get('after', -1))
        except ValueError:
            raise ValidationError({'after': 'Must be an integer.'})
        if frame is not None and frame['seq'] <= after:
            frame = None
        return Response(AgentLiveSerializer({'frame': frame, 'state': get_state(run.id)}).data)

    @extend_schema(request=AgentControlRequestSerializer, responses={202: AgentControlStateSerializer})
    @action(detail=True, methods=['post'])
    def control(self, request, pk=None):
        """Take the browser over from the agent, or hand it back. Taking it again refreshes
        the claim; control returns to the agent after two quiet minutes."""
        run = self.get_object()
        serializer = AgentControlRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data['action'] == 'take':
            if run.status != AgentRun.Status.RUNNING:
                raise ValidationError({'status': 'Only a running agent can be taken over.'})
            request_control(run.id, request.user.email or str(request.user.pk))
        else:
            release_control(run.id)
        return Response(AgentControlStateSerializer(get_state(run.id)).data, status=status.HTTP_202_ACCEPTED)

    @extend_schema(request=AgentInputSerializer, responses={204: None})
    @action(detail=True, methods=['post'])
    def input(self, request, pk=None):
        """Clicks, scrolling and keystrokes for the browser while the user drives it."""
        run = self.get_object()
        if get_state(run.id)['control'] != 'user':
            raise ValidationError({'control': 'Take control of the browser first.'})
        serializer = AgentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        push_input(run.id, serializer.validated_data['events'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses=AgentArtifactSerializer(many=True))
    @action(detail=True, methods=['get'])
    def artifacts(self, request, pk=None):
        """Files the run saved. While it is still running, newly written files are picked up
        from disk on each call, so they can be downloaded before the run ends."""
        run = self.get_object()
        if run.status == AgentRun.Status.RUNNING:
            collect_artifacts(run)
        return Response(AgentArtifactSerializer(run.artifacts.all(), many=True).data)

    @extend_schema(responses={(200, 'application/octet-stream'): OpenApiTypes.BINARY})
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
