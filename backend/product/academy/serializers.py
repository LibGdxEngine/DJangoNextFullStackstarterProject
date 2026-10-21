from django.db import models
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from . import models as m
from .services.common import balance
from .services.scheduling import zoned_times


class TenantSerializer(serializers.ModelSerializer):
    def get_fields(self):
        fields = super().get_fields()
        access = self.context.get("access")
        for name in ("organization", "created_at", "updated_at", "id"):
            if name in fields:
                fields[name].read_only = True
        if access:
            for field in fields.values():
                queryset = getattr(field, "queryset", None)
                if queryset is not None and hasattr(queryset.model, "organization_id"):
                    field.queryset = queryset.filter(organization=access.organization)
        return fields

    def validate(self, attrs):
        access = self.context.get("access")
        instance = self.instance
        if access:
            # Apply ownership rules to relation writes as well as object reads.
            for name, obj in attrs.items():
                if isinstance(obj, m.Student) and not access.students().filter(pk=obj.pk).exists():
                    raise serializers.ValidationError({name: "Student is outside your workspace."})
                if isinstance(obj, m.Session) and not access.sessions().filter(pk=obj.pk).exists():
                    raise serializers.ValidationError({name: "Session is outside your workspace."})
                if isinstance(obj, m.Teacher) and access.workspace == "teacher" and obj.pk not in access.teacher_ids:
                    raise serializers.ValidationError({name: "Choose your teacher profile."})
                if isinstance(obj, m.Enrollment) and not access.students().filter(pk=obj.student_id).exists():
                    raise serializers.ValidationError({name: "Enrollment is outside your workspace."})
            user = attrs.get("user")
            if user:
                from apps.organizations.models import OrganizationMember
                if not OrganizationMember.objects.filter(organization=access.organization, user=user).exists():
                    raise serializers.ValidationError({"user": "Link an existing academy member."})
        return attrs


def model_serializer(model, *, exclude=(), readonly=()):
    meta = type("Meta", (), {"model": model, "exclude": tuple(exclude), "read_only_fields": tuple(readonly)})
    return type(model.__name__ + "Serializer", (TenantSerializer,), {"Meta": meta, "__module__": __name__})


AcademySettingsSerializer = model_serializer(m.AcademySettings, readonly=("whatsapp_status", "whatsapp_connection"))
StaffRoleSerializer = model_serializer(m.StaffRole)
FamilySerializer = model_serializer(m.Family)
FamilyContactSerializer = model_serializer(m.FamilyContact)
TeacherSerializer = model_serializer(m.Teacher)
TeacherRateSerializer = model_serializer(m.TeacherRate)
AvailabilitySerializer = model_serializer(m.Availability)
StudentSerializer = model_serializer(m.Student, readonly=("status",))
StudentNoteSerializer = model_serializer(m.StudentNote, readonly=("author",))
PackageSerializer = model_serializer(m.Package)
BalanceEntrySerializer = model_serializer(m.BalanceEntry)
EarningEntrySerializer = model_serializer(m.EarningEntry)
PayrollSerializer = model_serializer(m.Payroll, readonly=("status", "approved_by", "approved_at", "paid_at", "payment_reference"))
EarningsIssueSerializer = model_serializer(m.EarningsIssue, readonly=("status", "resolution"))
SessionRequestSerializer = model_serializer(m.SessionRequest, readonly=("requested_by", "status", "policy_snapshot", "reviewed_by"))
MessageTemplateSerializer = model_serializer(m.MessageTemplate)
MessageAutomationSerializer = model_serializer(m.MessageAutomation)
MessageSerializer = model_serializer(m.Message)
ImportJobSerializer = model_serializer(m.ImportJob, exclude=("rows",))
HistoryEventSerializer = model_serializer(m.HistoryEvent)
LessonPreferenceSerializer = model_serializer(m.LessonPreference)


class EnrollmentSerializer(TenantSerializer):
    balance = serializers.SerializerMethodField()
    renewal_status = serializers.SerializerMethodField()

    class Meta:
        model = m.Enrollment
        fields = "__all__"

    @extend_schema_field(serializers.DecimalField(max_digits=10, decimal_places=2))
    def get_balance(self, obj):
        return str(balance(obj))

    def get_renewal_status(self, obj) -> str:
        from django.utils import timezone
        from zoneinfo import ZoneInfo
        today = timezone.now().astimezone(ZoneInfo(obj.student.timezone)).date()
        if obj.status == "pending":
            return "pending_payment"
        if obj.expires_on < today:
            return "expired"
        return "renewal_due" if balance(obj) <= 2 else "current"


class PaymentSerializer(TenantSerializer):
    has_receipt = serializers.SerializerMethodField()
    duplicate_ids = serializers.SerializerMethodField()

    class Meta:
        model = m.Payment
        exclude = ("receipt",)
        read_only_fields = ("receipt_name", "receipt_type", "receipt_sha256", "status", "submitted_by", "reviewed_by", "reviewed_at", "review_reason")

    def get_has_receipt(self, obj) -> bool:
        return bool(obj.receipt_sha256)

    @extend_schema_field(serializers.ListField(child=serializers.UUIDField()))
    def get_duplicate_ids(self, obj):
        access = self.context.get("access")
        if not access or "manage_finance" not in access.capabilities:
            return []
        from .services.finance import duplicate_payments
        return list(duplicate_payments(obj).values_list("id", flat=True))


class SessionSerializer(TenantSerializer):
    times = serializers.SerializerMethodField()
    student_name = serializers.CharField(source="student.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.name", read_only=True)

    class Meta:
        model = m.Session
        fields = "__all__"

    @extend_schema_field(serializers.DictField(child=serializers.DictField(child=serializers.CharField())))
    def get_times(self, obj):
        return zoned_times(obj.starts_at, obj.ends_at, obj.student, obj.teacher)


class RecurringScheduleSerializer(TenantSerializer):
    class Meta:
        model = m.RecurringSchedule
        fields = "__all__"
        read_only_fields = ("is_active",)


class ProgressInputSerializer(serializers.Serializer):
    surah = serializers.IntegerField(min_value=1, max_value=114)
    ayah_from = serializers.IntegerField(min_value=1, max_value=286)
    ayah_to = serializers.IntegerField(min_value=1, max_value=286)
    activity = serializers.ChoiceField(choices=["memorization", "revision", "recitation"])
    rating = serializers.IntegerField(min_value=1, max_value=5)

    def validate(self, attrs):
        from .quran import VERSE_COUNTS
        if attrs["ayah_to"] > VERSE_COUNTS[attrs["surah"] - 1]:
            raise serializers.ValidationError({"ayah_to": "Ayah exceeds the selected surah boundary."})
        if attrs["ayah_to"] < attrs["ayah_from"]:
            raise serializers.ValidationError({"ayah_to": "End ayah must follow start ayah."})
        return attrs


class QuranProgressSerializer(TenantSerializer):
    student = serializers.UUIDField(source="lesson.session.student_id", read_only=True)
    session = serializers.UUIDField(source="lesson.session_id", read_only=True)
    lesson_at = serializers.DateTimeField(source="lesson.session.starts_at", read_only=True)

    class Meta:
        model = m.QuranProgress
        fields = "__all__"


class LessonRecordSerializer(TenantSerializer):
    progress = QuranProgressSerializer(many=True, read_only=True)

    class Meta:
        model = m.LessonRecord
        fields = "__all__"

    def get_fields(self):
        fields = super().get_fields()
        access = self.context.get("access")
        if access and "view_internal" not in access.capabilities:
            fields.pop("internal_notes", None)
        return fields


class LessonReportInputSerializer(serializers.Serializer):
    attendance = serializers.ChoiceField(choices=["present", "late", "absent"])
    actual_minutes = serializers.IntegerField(min_value=0, max_value=480)
    late_minutes = serializers.IntegerField(min_value=0, max_value=480, default=0)
    family_notes = serializers.CharField(allow_blank=True, max_length=10000, default="")
    internal_notes = serializers.CharField(allow_blank=True, max_length=10000, default="")
    homework = serializers.CharField(allow_blank=True, max_length=10000, default="")
    progress = ProgressInputSerializer(many=True, required=False)


class ConfirmSerializer(serializers.Serializer):
    preview_token = serializers.CharField(required=False, allow_blank=True)
    reason = serializers.CharField(max_length=500)


class SessionActionSerializer(ConfirmSerializer):
    action = serializers.ChoiceField(choices=["cancel", "reschedule", "substitute", "approve_report", "correct_attendance"])
    initiator = serializers.ChoiceField(choices=["academy", "teacher", "family"], default="academy")
    deduct_student = serializers.BooleanField(required=False)
    pay_teacher = serializers.BooleanField(required=False)
    attendance = serializers.ChoiceField(choices=["present", "late", "absent"], required=False)
    starts_at = serializers.DateTimeField(required=False)
    teacher = serializers.UUIDField(required=False)
    notify_family = serializers.BooleanField(default=True)
    acknowledge_warnings = serializers.BooleanField(default=False)


    def validate(self, attrs):
        action = attrs["action"]
        if "teacher" in attrs and action != "substitute":
            raise serializers.ValidationError({"teacher": "Teacher changes require the substitute action."})
        if "starts_at" in attrs and action != "reschedule":
            raise serializers.ValidationError({"starts_at": "Time changes require the reschedule action."})
        if "attendance" in attrs and action != "correct_attendance":
            raise serializers.ValidationError({"attendance": "Attendance changes require the correction action."})
        return attrs


class BulkSessionActionSerializer(SessionActionSerializer):
    session_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=100)


class PurchaseSerializer(serializers.Serializer):
    student = serializers.UUIDField()
    package = serializers.UUIDField()
    starts_on = serializers.DateField()
    renewed_from = serializers.UUIDField(required=False)


class BalanceAdjustmentSerializer(ConfirmSerializer):
    delta = serializers.DecimalField(max_digits=10, decimal_places=2)
    idempotency_key = serializers.UUIDField()


class PaymentReviewSerializer(ConfirmSerializer):
    decision = serializers.ChoiceField(choices=["approved", "rejected"])
    acknowledge_duplicates = serializers.BooleanField(default=False)


class PayrollTransitionSerializer(serializers.Serializer):
    target = serializers.ChoiceField(choices=["reviewed", "approved", "paid"])
    preview_token = serializers.CharField(required=False, allow_blank=True)
    payment_reference = serializers.CharField(max_length=200, required=False, allow_blank=True)


class ArchiveSerializer(ConfirmSerializer):
    future_handling = serializers.ChoiceField(choices=["cancel", "none"])


class ScheduleWriteSerializer(RecurringScheduleSerializer):
    acknowledge_warnings = serializers.BooleanField(write_only=True, default=False)


class ScheduleChangesSerializer(RecurringScheduleSerializer):
    def get_fields(self):
        fields = super().get_fields()
        for field in fields.values():
            if not field.read_only:
                field.required = False
                field.default = serializers.empty
        return fields


class ScheduleEditSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=["this_session", "this_and_future", "whole_series"])
    from_session = serializers.UUIDField(required=False)
    changes = ScheduleChangesSerializer()
    acknowledge_warnings = serializers.BooleanField(default=False)
    preview_token = serializers.CharField(required=False, allow_blank=True)


class FileUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class ImportMapSerializer(serializers.Serializer):
    mapping = serializers.DictField(child=serializers.CharField())


class ImportConfirmSerializer(serializers.Serializer):
    preview_token = serializers.CharField(required=False)


class RequestReviewSerializer(ConfirmSerializer):
    decision = serializers.ChoiceField(choices=["approved", "rejected"])
    acknowledge_warnings = serializers.BooleanField(default=False)


class IssueResolutionSerializer(serializers.Serializer):
    resolution = serializers.CharField(max_length=5000)


class EarningAdjustmentSerializer(ConfirmSerializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    idempotency_key = serializers.UUIDField()


class JsonResponseSerializer(serializers.Serializer):
    """Structured workflow payload; keys are documented in the academy API guide."""
    data = serializers.JSONField()
    preview_token = serializers.CharField(required=False)


class WorkspaceSerializer(serializers.Serializer):
    organization = serializers.UUIDField()
    name = serializers.CharField()
    logo_url = serializers.CharField(allow_blank=True)
    language = serializers.CharField()
    timezone = serializers.CharField()
    workspaces = serializers.ListField(child=serializers.CharField())
    selected_workspace = serializers.CharField()
    capabilities = serializers.ListField(child=serializers.CharField())


class AcademyCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    slug = serializers.SlugField(max_length=255)
    timezone = serializers.CharField(default="Africa/Cairo")
    language = serializers.ChoiceField(choices=["ar", "en"], default="ar")


class StudentStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["active", "paused"])
    reason = serializers.CharField(max_length=500)


class MemberInviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=30)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=["MEMBER", "ADMIN"], default="MEMBER")

    def validate_phone(self, value):
        from apps.accounts.phone import normalize_phone
        if not value.startswith("+"):
            raise serializers.ValidationError("Include the country code.")
        try:
            return normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))


class AcademyMemberSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    user = serializers.UUIDField(source="user_id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    account_status = serializers.CharField(source="user.status", read_only=True)
    role = serializers.CharField(read_only=True)
