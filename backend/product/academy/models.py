"""Academy records. All domain rows belong to an Organization tenant.

Financial rows and session history are appended through services, never exposed as
editable CRUD resources. Foreign keys use PROTECT to retain operational history.
"""
from decimal import Decimal
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.db.models import Q, F
from apps.common.models import BaseModel
from .validators import currency_validator, validate_timezone, validate_weekdays


class TenantModel(BaseModel):
    organization = models.ForeignKey("organizations.Organization", on_delete=models.PROTECT)

    class Meta:
        abstract = True
        ordering = ["-created_at", "id"]

    def clean(self):
        super().clean()
        for field in self._meta.fields:
            if isinstance(field, models.ForeignKey) and field.name != "organization" and getattr(self, field.attname, None):
                related = getattr(self, field.name)
                if hasattr(related, "organization_id") and related.organization_id != self.organization_id:
                    raise ValidationError({field.name: "Record belongs to another academy."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class ConnectionStatus(models.TextChoices):
    NOT_CONNECTED = "not_connected", "Not connected"
    PENDING = "pending", "Pending"
    CONNECTED = "connected", "Connected"
    ACTION_REQUIRED = "action_required", "Action required"


class AcademySettings(TenantModel):
    organization = models.OneToOneField("organizations.Organization", on_delete=models.PROTECT, related_name="academy_settings")
    logo_url = models.URLField(blank=True)
    domain = models.CharField(max_length=253, blank=True)
    language = models.CharField(max_length=2, choices=[("ar", "Arabic"), ("en", "English")], default="ar")
    timezone = models.CharField(max_length=64, default="Africa/Cairo", validators=[validate_timezone])
    cancellation_hours = models.PositiveSmallIntegerField(default=12)
    late_cancel_deduct = models.BooleanField(default=True)
    late_cancel_pay_teacher = models.BooleanField(default=False)
    reminder_minutes = models.PositiveIntegerField(default=60, validators=[MinValueValidator(1), MaxValueValidator(10080)])
    low_balance_threshold = models.PositiveSmallIntegerField(default=2)
    setup_steps = models.JSONField(default=dict, blank=True)
    whatsapp_status = models.CharField(max_length=20, choices=ConnectionStatus.choices, default=ConnectionStatus.NOT_CONNECTED)
    whatsapp_connection = models.CharField(max_length=100, blank=True)

    def clean(self):
        super().clean()
        allowed = {"branding", "policies", "staff", "teachers", "families", "packages", "schedule", "whatsapp"}
        if not isinstance(self.setup_steps, dict) or set(self.setup_steps) - allowed or any(type(v) is not bool for v in self.setup_steps.values()):
            raise ValidationError({"setup_steps": "Use the eight checklist keys with boolean values."})


class StaffRole(TenantModel):
    class Role(models.TextChoices):
        COORDINATOR = "coordinator", "Coordinator"
        ACCOUNTANT = "accountant", "Accountant"
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    role = models.CharField(max_length=20, choices=Role.choices)
    is_active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "user", "role"], name="academy_unique_staff_role")]


class Family(TenantModel):
    name = models.CharField(max_length=200)
    external_id = models.CharField(max_length=100, blank=True)
    language = models.CharField(max_length=2, choices=[("ar", "Arabic"), ("en", "English")], default="ar")
    timezone = models.CharField(max_length=64, default="Africa/Cairo", validators=[validate_timezone])
    is_active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "external_id"], condition=~Q(external_id=""), name="academy_family_external_id")]


class FamilyContact(TenantModel):
    family = models.ForeignKey(Family, on_delete=models.PROTECT, related_name="contacts")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20)
    email = models.EmailField(blank=True)
    relationship = models.CharField(max_length=20, choices=[("parent", "Parent"), ("guardian", "Guardian"), ("self", "Adult student")], default="parent")
    receives_notifications = models.BooleanField(default=True)

    def clean(self):
        super().clean()
        from apps.accounts.phone import normalize_phone
        try:
            self.phone = normalize_phone(self.phone)
        except ValueError as exc:
            raise ValidationError({"phone": str(exc)})

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["family", "phone"], name="academy_family_contact_phone")]


class Teacher(TenantModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)
    name = models.CharField(max_length=200)
    timezone = models.CharField(max_length=64, default="Africa/Cairo", validators=[validate_timezone])
    language = models.CharField(max_length=2, choices=[("ar", "Arabic"), ("en", "English")], default="ar")
    meeting_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "user"], condition=Q(user__isnull=False), name="academy_teacher_user")]


class TeacherRate(TenantModel):
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT, related_name="rates")
    amount = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    currency = models.CharField(max_length=3, validators=[currency_validator])
    basis = models.CharField(max_length=10, choices=[("session", "Per session"), ("hour", "Per hour")], default="session")
    effective_from = models.DateField()

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["teacher", "effective_from"], name="academy_teacher_rate_date"), models.CheckConstraint(condition=Q(amount__gte=0), name="academy_nonnegative_rate")]


class Availability(TenantModel):
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT, related_name="availability")
    weekday = models.PositiveSmallIntegerField(validators=[MaxValueValidator(6)])
    start_time = models.TimeField()
    end_time = models.TimeField()
    timezone = models.CharField(max_length=64, validators=[validate_timezone])

    class Meta(TenantModel.Meta):
        constraints = [models.CheckConstraint(condition=Q(end_time__gt=F("start_time")), name="academy_availability_order")]


class Student(TenantModel):
    family = models.ForeignKey(Family, on_delete=models.PROTECT, related_name="students")
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT, related_name="students", null=True, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)
    name = models.CharField(max_length=200)
    external_id = models.CharField(max_length=100, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    is_adult = models.BooleanField(default=False)
    language = models.CharField(max_length=2, choices=[("ar", "Arabic"), ("en", "English")], default="ar")
    timezone = models.CharField(max_length=64, default="Africa/Cairo", validators=[validate_timezone])
    status = models.CharField(max_length=10, choices=[("active", "Active"), ("paused", "Paused"), ("archived", "Archived")], default="active")

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "external_id"], condition=~Q(external_id=""), name="academy_student_external_id")]


class StudentNote(TenantModel):
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    visibility = models.CharField(max_length=10, choices=[("internal", "Internal staff"), ("family", "Family visible")], default="internal")
    text = models.TextField(max_length=10000)


class Package(TenantModel):
    name = models.CharField(max_length=200)
    lesson_count = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    duration_minutes = models.PositiveSmallIntegerField(validators=[MinValueValidator(5), MaxValueValidator(240)])
    validity_days = models.PositiveIntegerField(default=30, validators=[MinValueValidator(1)])
    price = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    currency = models.CharField(max_length=3, validators=[currency_validator])
    is_active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        constraints = [models.CheckConstraint(condition=Q(price__gte=0) & Q(lesson_count__gt=0) & Q(duration_minutes__gte=5) & Q(validity_days__gt=0), name="academy_valid_package")]


class Enrollment(TenantModel):
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="enrollments")
    package = models.ForeignKey(Package, on_delete=models.PROTECT)
    renewed_from = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True)
    # Purchased terms are snapshots; editing a catalog package cannot change a purchase.
    lesson_count = models.PositiveIntegerField()
    duration_minutes = models.PositiveSmallIntegerField()
    price = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, validators=[currency_validator])
    starts_on = models.DateField()
    expires_on = models.DateField()
    status = models.CharField(max_length=20, choices=[("pending", "Pending payment"), ("active", "Active"), ("closed", "Closed")], default="pending")

    class Meta(TenantModel.Meta):
        constraints = [models.CheckConstraint(condition=Q(expires_on__gte=F("starts_on")) & Q(price__gte=0) & Q(lesson_count__gt=0), name="academy_valid_enrollment")]

    def clean(self):
        super().clean()
        if self.renewed_from_id and self.renewed_from.student_id != self.student_id:
            raise ValidationError({"renewed_from": "Renewal must belong to this student."})


class RecurringSchedule(TenantModel):
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="schedules")
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT, related_name="schedules")
    enrollment = models.ForeignKey(Enrollment, on_delete=models.PROTECT)
    timezone = models.CharField(max_length=64, validators=[validate_timezone], help_text="Keep this local time fixed in this IANA zone.")
    weekdays = models.JSONField(validators=[validate_weekdays])
    local_time = models.TimeField()
    starts_on = models.DateField()
    ends_on = models.DateField()
    duration_minutes = models.PositiveSmallIntegerField(validators=[MinValueValidator(5), MaxValueValidator(240)])
    meeting_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)

    def clean(self):
        super().clean()
        if self.enrollment_id and self.enrollment.student_id != self.student_id:
            raise ValidationError({"enrollment": "Enrollment must belong to this student."})
        if self.starts_on and self.ends_on and (self.ends_on < self.starts_on or (self.ends_on - self.starts_on).days > 366):
            raise ValidationError({"ends_on": "Schedule must span between 0 and 366 days."})


class Session(TenantModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        NEEDS_REVIEW = "needs_review", "Needs review"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
    series = models.ForeignKey(RecurringSchedule, on_delete=models.PROTECT, related_name="sessions", null=True, blank=True)
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="sessions")
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT, related_name="sessions")
    enrollment = models.ForeignKey(Enrollment, on_delete=models.PROTECT, related_name="sessions")
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField()
    meeting_url = models.URLField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED, db_index=True)
    attendance = models.CharField(max_length=10, choices=[("unknown", "Unknown"), ("present", "Present"), ("late", "Late"), ("absent", "Absent")], default="unknown")
    actual_minutes = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(480)])
    late_minutes = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(480)])
    version = models.PositiveIntegerField(default=1)

    class Meta(TenantModel.Meta):
        ordering = ["starts_at", "id"]
        indexes = [models.Index(fields=["organization", "teacher", "starts_at"]), models.Index(fields=["organization", "student", "starts_at"])]
        constraints = [models.CheckConstraint(condition=Q(ends_at__gt=F("starts_at")), name="academy_session_time_order")]

    def clean(self):
        super().clean()
        if self.enrollment_id and self.enrollment.student_id != self.student_id:
            raise ValidationError({"enrollment": "Enrollment must belong to this student."})


class LessonRecord(TenantModel):
    session = models.OneToOneField(Session, on_delete=models.PROTECT, related_name="lesson_record")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    family_notes = models.TextField(blank=True, max_length=10000)
    internal_notes = models.TextField(blank=True, max_length=10000)
    homework = models.TextField(blank=True, max_length=10000)


class QuranProgress(TenantModel):
    def clean(self):
        super().clean()
        from .quran import VERSE_COUNTS
        if self.surah and 1 <= self.surah <= 114 and self.ayah_to and self.ayah_to > VERSE_COUNTS[self.surah - 1]:
            raise ValidationError({"ayah_to": "Ayah exceeds the selected surah boundary."})

    lesson = models.ForeignKey(LessonRecord, on_delete=models.PROTECT, related_name="progress")
    surah = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(114)])
    ayah_from = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(286)])
    ayah_to = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(286)])
    activity = models.CharField(max_length=20, choices=[("memorization", "Memorization"), ("revision", "Revision"), ("recitation", "Recitation")])
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])

    class Meta(TenantModel.Meta):
        constraints = [models.CheckConstraint(condition=Q(ayah_to__gte=F("ayah_from")) & Q(surah__gte=1) & Q(surah__lte=114), name="academy_valid_quran_range")]


class LessonPreference(TenantModel):
    teacher = models.OneToOneField(Teacher, on_delete=models.PROTECT, related_name="lesson_preferences")
    reusable_notes = models.JSONField(default=list, blank=True)
    remembered_selections = models.JSONField(default=dict, blank=True)


class BalanceEntry(TenantModel):
    enrollment = models.ForeignKey(Enrollment, on_delete=models.PROTECT, related_name="ledger")
    session = models.ForeignKey(Session, on_delete=models.PROTECT, null=True, blank=True)
    delta = models.DecimalField(max_digits=10, decimal_places=2)
    reason = models.CharField(max_length=500)
    key = models.CharField(max_length=160)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "key"], name="academy_balance_idempotency")]


class Payment(TenantModel):
    enrollment = models.ForeignKey(Enrollment, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    currency = models.CharField(max_length=3, validators=[currency_validator])
    reference = models.CharField(max_length=200, blank=True)
    receipt = models.BinaryField(blank=True, default=bytes)
    receipt_name = models.CharField(max_length=200, blank=True)
    receipt_type = models.CharField(max_length=100, blank=True)
    receipt_sha256 = models.CharField(max_length=64, blank=True, db_index=True)
    status = models.CharField(max_length=10, choices=[("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")], default="pending")
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="academy_payments_submitted")
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="academy_payments_reviewed", null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_reason = models.CharField(max_length=500, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="academy_payment_positive")]

    def clean(self):
        super().clean()
        if self.enrollment_id and self.currency != self.enrollment.currency:
            raise ValidationError({"currency": "Payment currency must match the enrollment."})


class Payroll(TenantModel):
    month = models.DateField(help_text="First day of the payroll month.")
    status = models.CharField(max_length=10, choices=[("draft", "Draft"), ("reviewed", "Reviewed"), ("approved", "Approved"), ("paid", "Paid")], default="draft")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    payment_reference = models.CharField(max_length=200, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "month"], name="academy_payroll_month")]

    def clean(self):
        super().clean()
        if self.month and self.month.day != 1:
            raise ValidationError({"month": "Use the first day of the month."})


class EarningEntry(TenantModel):
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT, related_name="earnings")
    session = models.ForeignKey(Session, on_delete=models.PROTECT, null=True, blank=True)
    payroll = models.ForeignKey(Payroll, on_delete=models.PROTECT, related_name="entries", null=True, blank=True)
    adjustment_of = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, validators=[currency_validator])
    earned_on = models.DateField()
    reason = models.CharField(max_length=500)
    key = models.CharField(max_length=160)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "key"], name="academy_earning_idempotency")]


class EarningsIssue(TenantModel):
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT)
    entry = models.ForeignKey(EarningEntry, on_delete=models.PROTECT, null=True, blank=True)
    session = models.ForeignKey(Session, on_delete=models.PROTECT, null=True, blank=True)
    description = models.TextField(max_length=5000)
    status = models.CharField(max_length=10, choices=[("open", "Open"), ("resolved", "Resolved")], default="open")
    resolution = models.TextField(blank=True, max_length=5000)

    def clean(self):
        super().clean()
        if not self.entry_id and not self.session_id:
            raise ValidationError("Tie the issue to a session or an earning entry.")
        if self.entry_id and self.entry.teacher_id != self.teacher_id or self.session_id and self.session.teacher_id != self.teacher_id:
            raise ValidationError("The issue must concern this teacher.")


class SessionRequest(TenantModel):
    session = models.ForeignKey(Session, on_delete=models.PROTECT, related_name="requests")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    kind = models.CharField(max_length=12, choices=[("cancel", "Cancel"), ("reschedule", "Reschedule")])
    reason = models.CharField(max_length=500)
    proposed_start = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=[("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")], default="pending")
    policy_snapshot = models.JSONField(default=dict)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="academy_requests_reviewed")

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["session"], condition=Q(status="pending"), name="academy_pending_session_request")]


class MessageTemplate(TenantModel):
    name = models.SlugField(max_length=100)
    provider_template = models.CharField(max_length=200)
    language = models.CharField(max_length=2, choices=[("ar", "Arabic"), ("en", "English")])
    body = models.TextField(max_length=5000)
    is_active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "name", "language"], name="academy_message_template")]


class MessageAutomation(TenantModel):
    event = models.CharField(max_length=20, choices=[("reminder", "Class reminder"), ("session_changed", "Schedule changed"), ("low_balance", "Low balance"), ("renewal", "Renewal")])
    template = models.ForeignKey(MessageTemplate, on_delete=models.PROTECT)
    is_enabled = models.BooleanField(default=False)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "event"], name="academy_automation_event")]


class Message(TenantModel):
    session = models.ForeignKey(Session, on_delete=models.PROTECT, null=True, blank=True)
    family = models.ForeignKey(Family, on_delete=models.PROTECT)
    template = models.ForeignKey(MessageTemplate, on_delete=models.PROTECT)
    destination = models.CharField(max_length=20)
    variables = models.JSONField(default=dict)
    due_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=20, choices=[("queued", "Queued"), ("sending", "Sending"), ("sent", "Sent"), ("failed", "Failed"), ("cancelled", "Cancelled"), ("action_required", "Action required")], default="queued")
    key = models.CharField(max_length=200)
    provider_message_id = models.CharField(max_length=200, blank=True)
    error = models.CharField(max_length=500, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [models.UniqueConstraint(fields=["organization", "key"], name="academy_message_idempotency")]


class ImportJob(TenantModel):
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    filename = models.CharField(max_length=200)
    status = models.CharField(max_length=12, choices=[("uploaded", "Uploaded"), ("validated", "Validated"), ("imported", "Imported")], default="uploaded")
    columns = models.JSONField(default=list)
    rows = models.JSONField(default=list)
    mapping = models.JSONField(default=dict, blank=True)
    errors = models.JSONField(default=list, blank=True)
    result = models.JSONField(default=dict, blank=True)


class HistoryEvent(TenantModel):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)
    entity = models.CharField(max_length=50)
    entity_id = models.UUIDField()
    action = models.CharField(max_length=100)
    reason = models.CharField(max_length=500, blank=True)
    data = models.JSONField(default=dict, blank=True)

    class Meta(TenantModel.Meta):
        indexes = [models.Index(fields=["organization", "entity", "entity_id"])]
