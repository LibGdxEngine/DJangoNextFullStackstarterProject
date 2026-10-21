from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import mixins, permissions, viewsets, filters
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from drf_spectacular.utils import extend_schema, OpenApiParameter
from apps.organizations.models import Organization
from .access import Access
from . import models as m
from .services.common import lock_academy, history


class AcademyPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


def redact_financial(value, access):
    if "view_finance" in access.capabilities:
        return value
    hidden = {"teacher_amount", "teacher_currency", "previous_earnings", "substitute_rate", "closed_payroll_adjustment", "teacher_pay_effects"}
    if isinstance(value, dict):
        return {key: redact_financial(item, access) for key, item in value.items() if key not in hidden}
    if isinstance(value, list):
        return [redact_financial(item, access) for item in value]
    return value


@extend_schema(tags=["academy"], parameters=[OpenApiParameter("organization_id", str, OpenApiParameter.PATH), OpenApiParameter("X-Academy-Workspace", str, OpenApiParameter.HEADER, enum=["management", "teacher", "family"])])
class TenantViewSet(viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = AcademyPagination
    filter_backends = [filters.SearchFilter]
    search_fields = []
    http_method_names = ["get", "post", "patch", "head", "options"]
    capability = None
    model = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.organization = get_object_or_404(Organization, pk=kwargs["organization_id"], is_active=True)
        self.access = Access(request.user, self.organization, request.headers.get("X-Academy-Workspace"))

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["access"] = getattr(self, "access", None)
        return context

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.model.objects.none()
        access, model = self.access, self.model
        qs = model.objects.filter(organization=self.organization)
        if model == m.Student:
            qs = access.students().select_related("family", "teacher")
        elif model == m.Session:
            qs = access.sessions().select_related("student__family", "teacher", "enrollment", "organization")
        elif model == m.Family:
            if access.workspace == "teacher":
                raise PermissionDenied("Family contact details are restricted to management and families.")
            if access.workspace == "family":
                qs = qs.filter(pk__in=access.students().values("family_id"))
        elif model == m.FamilyContact:
            if access.workspace != "management":
                raise PermissionDenied("Contact management is restricted to academy staff.")
        elif model == m.Teacher:
            if access.workspace == "teacher":
                qs = qs.filter(pk__in=access.teacher_ids)
            elif access.workspace == "family":
                # Family session cards contain teacher names, without staff account data.
                raise PermissionDenied("Use the family's session records to see assigned teachers.")
        elif model in {m.TeacherRate, m.EarningEntry}:
            if access.workspace == "teacher":
                qs = qs.filter(teacher_id__in=access.teacher_ids)
            else:
                access.require("view_finance")
        elif model == m.Availability:
            if access.workspace == "teacher":
                qs = qs.filter(teacher_id__in=access.teacher_ids)
            elif access.workspace != "management":
                raise PermissionDenied()
        elif model == m.StudentNote:
            qs = qs.filter(student__in=access.students())
            if "view_internal" not in access.capabilities:
                qs = qs.filter(visibility="family")
        elif model in {m.Enrollment, m.RecurringSchedule}:
            qs = qs.filter(student__in=access.students())
            if access.workspace == "teacher":
                raise PermissionDenied("Use your sessions to see the teaching schedule.")
        elif model in {m.LessonRecord, m.QuranProgress}:
            prefix = "session" if model == m.LessonRecord else "lesson__session"
            qs = qs.filter(**{prefix + "__in": access.sessions()})
            if access.workspace == "family":
                qs = qs.filter(**{prefix + "__status": "completed"})
        elif model in {m.Payment, m.BalanceEntry}:
            if access.workspace == "teacher":
                raise PermissionDenied()
            qs = qs.filter(enrollment__student__in=access.students())
        elif model == m.SessionRequest:
            qs = qs.filter(session__in=access.sessions())
        elif model == m.EarningsIssue:
            if access.workspace == "teacher":
                qs = qs.filter(teacher_id__in=access.teacher_ids)
            else:
                access.require("view_finance")
        elif model == m.LessonPreference:
            if access.workspace != "teacher":
                raise PermissionDenied("Lesson shortcuts are personal to the teacher.")
            qs = qs.filter(teacher_id__in=access.teacher_ids)
        elif model == m.Payroll:
            access.require("view_finance")
        elif model == m.StaffRole:
            access.require("manage_roles")
        elif model in {m.Message, m.MessageAutomation, m.MessageTemplate, m.AcademySettings}:
            if access.workspace != "management":
                raise PermissionDenied()
        elif model == m.ImportJob:
            access.require("import")
        elif model == m.HistoryEvent:
            if access.workspace != "management":
                raise PermissionDenied()
            if "view_finance" not in access.capabilities:
                qs = qs.exclude(entity__in=["teacherrate", "earningentry", "payroll", "earningsissue"])
        elif model == m.Package:
            if access.workspace == "teacher":
                raise PermissionDenied()
            if access.workspace == "family":
                qs = qs.filter(is_active=True)
        for name in ("status", "student", "teacher", "family", "enrollment", "session", "payroll", "entity", "entity_id", "visibility", "is_active", "currency"):
            if name not in self.request.query_params:
                continue
            try:
                field = model._meta.get_field(name)
            except Exception:
                continue
            raw = self.request.query_params[name]
            try:
                value = field.target_field.to_python(raw) if field.is_relation else field.to_python(raw)
            except (ValueError, DjangoValidationError):
                raise ValidationError({name: "Invalid filter value."})
            qs = qs.filter(**{name: value})
        if model == m.Session:
            from rest_framework.fields import DateTimeField
            for param, lookup in [("starts_after", "starts_at__gte"), ("starts_before", "starts_at__lt")]:
                if param in self.request.query_params:
                    qs = qs.filter(**{lookup: DateTimeField().run_validation(self.request.query_params[param])})
        if model == m.EarningEntry:
            from rest_framework.fields import DateField
            for param, lookup in [("earned_after", "earned_on__gte"), ("earned_before", "earned_on__lte")]:
                if param in self.request.query_params:
                    qs = qs.filter(**{lookup: DateField().run_validation(self.request.query_params[param])})
        return qs

    def require_write(self):
        if not self.capability:
            raise PermissionDenied("This record is read-only.")
        self.access.require(self.capability)

    def perform_create(self, serializer):
        self.require_write()
        instance = serializer.save(organization=self.organization)
        history(instance, self.request.user, "created")

    def perform_update(self, serializer):
        self.require_write()
        instance = serializer.save()
        history(instance, self.request.user, "updated", fields=list(serializer.validated_data))



class CreateMixin(mixins.CreateModelMixin):
    def perform_create(self, serializer):
        return TenantViewSet.perform_create(self, serializer)

    def create(self, request, *args, **kwargs):
        with transaction.atomic():
            lock_academy(self.organization.id)
            return super().create(request, *args, **kwargs)



class UpdateMixin(mixins.UpdateModelMixin):
    def perform_update(self, serializer):
        return TenantViewSet.perform_update(self, serializer)

    def partial_update(self, request, *args, **kwargs):
        with transaction.atomic():
            lock_academy(self.organization.id)
            return super().partial_update(request, *args, **kwargs)


class ReadViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, TenantViewSet):
    pass


class CrudViewSet(CreateMixin, UpdateMixin, ReadViewSet):
    pass
