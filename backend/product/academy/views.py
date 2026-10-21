import hashlib
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from django.db import transaction
from django.db.models import Q, Sum, Count
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiTypes
from . import models as m, serializers as s
from .views_base import TenantViewSet, ReadViewSet, CrudViewSet, CreateMixin, UpdateMixin, redact_financial
from .services import finance, scheduling, sessions, imports
from .services.common import lock_academy, history, balance, preview_token, check_preview, settings_for, monetary_totals


def validate_input(serializer_class, request, context=None):
    serializer = serializer_class(data=request.data, context=context or {})
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def confirmation(payload, data, access):
    if not data.get("preview_token"):
        return Response({"data": redact_financial(payload, access), "preview_token": preview_token(payload)})
    check_preview(payload, data["preview_token"])
    return None


class AcademySettingsViewSet(UpdateMixin, ReadViewSet):
    model = m.AcademySettings
    serializer_class = s.AcademySettingsSerializer
    capability = "manage_settings"

    def list(self, request, *args, **kwargs):
        settings_for(self.organization)
        return super().list(request, *args, **kwargs)


class StaffRoleViewSet(CrudViewSet):
    model = m.StaffRole
    serializer_class = s.StaffRoleSerializer
    capability = "manage_roles"


class FamilyViewSet(CrudViewSet):
    model = m.Family
    serializer_class = s.FamilySerializer
    capability = "manage_people"
    search_fields = ["name", "external_id"]


class FamilyContactViewSet(CrudViewSet):
    model = m.FamilyContact
    serializer_class = s.FamilyContactSerializer
    capability = "manage_people"
    search_fields = ["name", "phone"]


class TeacherViewSet(CrudViewSet):
    model = m.Teacher
    serializer_class = s.TeacherSerializer
    capability = "manage_people"
    search_fields = ["name"]


class TeacherRateViewSet(CreateMixin, ReadViewSet):
    model = m.TeacherRate
    serializer_class = s.TeacherRateSerializer
    capability = "manage_finance"


class AvailabilityViewSet(CrudViewSet):
    model = m.Availability
    serializer_class = s.AvailabilitySerializer
    capability = "manage_schedule"

    def require_write(self):
        if self.access.workspace != "teacher":
            super().require_write()


class StudentViewSet(CrudViewSet):
    model = m.Student
    serializer_class = s.StudentSerializer
    capability = "manage_people"
    search_fields = ["name", "external_id", "family__name"]

    @extend_schema(request=s.ArchiveSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None, **kwargs):
        self.access.require("manage_people")
        data = validate_input(s.ArchiveSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            student = self.get_object()
            payload = sessions.archive_preview(student, data["future_handling"], data["reason"])
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            sessions.archive_student(student, data["future_handling"], data["reason"], request.user)
            return Response({"data": self.get_serializer(student).data})

    @extend_schema(request=s.StudentStatusSerializer, responses=s.StudentSerializer)
    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None, **kwargs):
        self.access.require("manage_people")
        data = validate_input(s.StudentStatusSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            student = self.get_object()
            if student.status == "archived":
                raise ValidationError("Archived students cannot be reactivated through this action.")
            if data["status"] == "paused" and student.sessions.filter(status="scheduled").exists():
                raise ValidationError("Cancel or reschedule outstanding sessions before pausing.")
            student.status = data["status"]
            student.save()
            history(student, request.user, "status_changed", data["reason"], status=student.status)
            return Response(self.get_serializer(student).data)


class StudentNoteViewSet(CreateMixin, ReadViewSet):
    model = m.StudentNote
    serializer_class = s.StudentNoteSerializer
    capability = "report_lesson"

    def perform_create(self, serializer):
        self.require_write()
        instance = serializer.save(organization=self.organization, author=self.request.user)
        history(instance, self.request.user, "created")


class PackageViewSet(CrudViewSet):
    model = m.Package
    serializer_class = s.PackageSerializer
    capability = "manage_finance"
    search_fields = ["name"]


class EnrollmentViewSet(ReadViewSet):
    model = m.Enrollment
    serializer_class = s.EnrollmentSerializer

    @extend_schema(request=s.PurchaseSerializer, responses={201: s.EnrollmentSerializer})
    def create(self, request, *args, **kwargs):
        self.access.require("manage_finance")
        data = validate_input(s.PurchaseSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            student = get_object_or_404(self.access.students(), pk=data["student"])
            package = get_object_or_404(m.Package, organization=self.organization, pk=data["package"])
            previous = get_object_or_404(m.Enrollment, organization=self.organization, student=student, pk=data["renewed_from"]) if data.get("renewed_from") else None
            enrollment = finance.purchase(student, package, data["starts_on"], request.user, previous)
            if not enrollment.price:
                finance.activate_enrollment(enrollment, request.user)
            return Response(self.get_serializer(enrollment).data, status=201)

    @extend_schema(request=s.BalanceAdjustmentSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"], url_path="adjust-balance")
    def adjust_balance(self, request, pk=None, **kwargs):
        self.access.require("manage_finance")
        data = validate_input(s.BalanceAdjustmentSerializer, request)
        if not data["delta"]:
            raise ValidationError({"delta": "Adjustment cannot be zero."})
        with transaction.atomic():
            lock_academy(self.organization.id)
            enrollment = self.get_object()
            key = f"adjustment:{data['idempotency_key']}"
            existing = m.BalanceEntry.objects.filter(organization=self.organization, key=key).first()
            if existing:
                if existing.enrollment_id != enrollment.id or existing.delta != data["delta"] or existing.reason != data["reason"]:
                    raise ValidationError("Idempotency key was used for a different adjustment.")
                return Response({"data": s.BalanceEntrySerializer(existing).data})
            payload = finance.balance_preview(enrollment, data["delta"], data["reason"])
            payload["idempotency_key"] = str(data["idempotency_key"])
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            entry = m.BalanceEntry.objects.create(organization=self.organization, enrollment=enrollment, delta=data["delta"], key=key, reason=data["reason"], actor=request.user)
            history(enrollment, request.user, "balance_adjusted", data["reason"], delta=data["delta"])
            return Response({"data": s.BalanceEntrySerializer(entry).data})


class BalanceEntryViewSet(ReadViewSet):
    model = m.BalanceEntry
    serializer_class = s.BalanceEntrySerializer


class RecurringScheduleViewSet(ReadViewSet):
    model = m.RecurringSchedule
    serializer_class = s.RecurringScheduleSerializer

    def candidate(self, request):
        self.access.require("manage_schedule")
        data = validate_input(s.ScheduleWriteSerializer, request, self.get_serializer_context())
        acknowledge = data.pop("acknowledge_warnings", False)
        return m.RecurringSchedule(organization=self.organization, **data), acknowledge

    @extend_schema(request=s.ScheduleWriteSerializer, responses=s.JsonResponseSerializer)
    @action(detail=False, methods=["post"])
    def preview(self, request, **kwargs):
        series, _ = self.candidate(request)
        return Response({"data": scheduling.schedule_preview(series)})

    @extend_schema(request=s.ScheduleWriteSerializer, responses={201: s.RecurringScheduleSerializer})
    def create(self, request, *args, **kwargs):
        series, acknowledge = self.candidate(request)
        series = scheduling.create_schedule(series, request.user, acknowledge)
        return Response(self.get_serializer(series).data, status=201)

    @extend_schema(request=s.ScheduleEditSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"])
    def edit(self, request, pk=None, **kwargs):
        self.access.require("manage_schedule")
        data = validate_input(s.ScheduleEditSerializer, request, self.get_serializer_context())
        with transaction.atomic():
            lock_academy(self.organization.id)
            series = self.get_object()
            anchor = get_object_or_404(self.access.sessions(), pk=data["from_session"]) if data.get("from_session") else None
            args = (series, data["changes"], data["scope"], anchor, request.user, data["acknowledge_warnings"])
            payload = scheduling.edit_schedule(*args, preview_only=True)
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            result = scheduling.edit_schedule(*args)
            return Response({"data": self.get_serializer(result).data})


class SessionViewSet(ReadViewSet):
    model = m.Session
    serializer_class = s.SessionSerializer
    search_fields = ["student__name", "teacher__name"]

    def action_data(self, request, bulk=False):
        data = validate_input(s.BulkSessionActionSerializer if bulk else s.SessionActionSerializer, request)
        self.access.require("approve_session" if data["action"] in {"approve_report", "correct_attendance"} else "manage_schedule")
        if data.get("teacher"):
            data["teacher"] = get_object_or_404(m.Teacher, organization=self.organization, pk=data["teacher"], is_active=True)
        return data

    @extend_schema(request=s.SessionActionSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"], url_path="transition")
    def transition(self, request, pk=None, **kwargs):
        data = self.action_data(request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            session = self.get_object()
            payload = sessions.session_action_preview(session, data)
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            sessions.apply_session_action(session, data, request.user)
            return Response({"data": self.get_serializer(session).data})

    @extend_schema(request=s.BulkSessionActionSerializer, responses=s.JsonResponseSerializer)
    @action(detail=False, methods=["post"], url_path="bulk-transition")
    def bulk_transition(self, request, **kwargs):
        data = self.action_data(request, bulk=True)
        if data["action"] not in {"cancel", "approve_report"}:
            raise ValidationError({"action": "Bulk actions support cancellation or report approval."})
        ids = data["session_ids"]
        if len(set(ids)) != len(ids):
            raise ValidationError({"session_ids": "Each session must appear once."})
        with transaction.atomic():
            lock_academy(self.organization.id)
            selected = list(self.get_queryset().filter(pk__in=ids).order_by("id"))
            if len(selected) != len(ids):
                raise ValidationError({"session_ids": "One or more sessions are outside your workspace."})
            payload = {"sessions": [sessions.session_action_preview(item, data) for item in selected]}
            combined = {}
            for item in payload["sessions"]:
                effect = item.get("financial_effects")
                if effect:
                    group = combined.setdefault(effect["enrollment"], {"current_balance": Decimal(effect["current_balance"]), "change": Decimal("0")})
                    group["change"] += Decimal(effect["balance_change"])
            payload["combined_balance_effects"] = [{"enrollment": key, "current_balance": str(group["current_balance"]), "change": str(group["change"]), "resulting_balance": str(group["current_balance"] + group["change"])} for key, group in sorted(combined.items())]
            if any(Decimal(group["resulting_balance"]) < 0 for group in payload["combined_balance_effects"]):
                raise ValidationError("The bulk action would exceed an enrollment's remaining balance.")
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            for item in selected:
                sessions.apply_session_action(item, data, request.user)
            return Response({"data": {"changed_session_ids": [str(item.id) for item in selected]}})

    @extend_schema(request=s.LessonReportInputSerializer, responses={201: s.LessonRecordSerializer})
    @action(detail=True, methods=["post"], url_path="lesson-report")
    def lesson_report(self, request, pk=None, **kwargs):
        self.access.require("report_lesson")
        data = validate_input(s.LessonReportInputSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            record = sessions.submit_report(self.get_object(), data, request.user)
            return Response(s.LessonRecordSerializer(record, context=self.get_serializer_context()).data, status=201)

    @extend_schema(responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["get"], url_path="cancellation-policy")
    def cancellation_policy(self, request, pk=None, **kwargs):
        return Response({"data": sessions.cancellation_policy(self.get_object())})


class LessonRecordViewSet(ReadViewSet):
    model = m.LessonRecord
    serializer_class = s.LessonRecordSerializer


class QuranProgressViewSet(ReadViewSet):
    model = m.QuranProgress
    serializer_class = s.QuranProgressSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if not getattr(self, "swagger_fake_view", False) and self.request.query_params.get("student"):
            from rest_framework.fields import UUIDField
            qs = qs.filter(lesson__session__student_id=UUIDField().run_validation(self.request.query_params["student"]))
        return qs.select_related("lesson__session").order_by("lesson__session__starts_at", "created_at")


class LessonPreferenceViewSet(CrudViewSet):
    model = m.LessonPreference
    serializer_class = s.LessonPreferenceSerializer
    capability = "report_lesson"

    def require_write(self):
        if self.access.workspace != "teacher":
            raise PermissionDenied("Lesson preferences belong to the teacher workspace.")


class PaymentViewSet(CreateMixin, ReadViewSet):
    model = m.Payment
    serializer_class = s.PaymentSerializer
    capability = "manage_finance"

    def perform_create(self, serializer):
        if self.access.workspace != "family":
            self.access.require("manage_finance")
        if serializer.validated_data["enrollment"].status == "closed":
            raise ValidationError("This enrollment is closed.")
        payment = serializer.save(organization=self.organization, submitted_by=self.request.user)
        history(payment, self.request.user, "submitted")

    @extend_schema(request=s.FileUploadSerializer, responses=s.PaymentSerializer)
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser], url_path="upload-receipt")
    def upload_receipt(self, request, pk=None, **kwargs):
        if self.access.workspace != "family":
            self.access.require("manage_finance")
        data = validate_input(s.FileUploadSerializer, request)
        upload = data["file"]
        if upload.size > 5 * 1024 * 1024:
            raise ValidationError({"file": "Maximum receipt size is 5 MB."})
        content = upload.read()
        file_type = "application/pdf" if content.startswith(b"%PDF-") else "image/png" if content.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if content.startswith(b"\xff\xd8\xff") else None
        if not file_type:
            raise ValidationError({"file": "Use a PDF, PNG or JPEG receipt."})
        with transaction.atomic():
            lock_academy(self.organization.id)
            payment = self.get_object()
            if payment.status != "pending":
                raise ValidationError("Reviewed receipts cannot be replaced.")
            payment.receipt = content
            payment.receipt_name = upload.name[:200]
            payment.receipt_type = file_type
            payment.receipt_sha256 = hashlib.sha256(content).hexdigest()
            payment.save()
            history(payment, request.user, "receipt_uploaded", sha256=payment.receipt_sha256)
            return Response(self.get_serializer(payment).data)

    @extend_schema(responses={(200, "application/octet-stream"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None, **kwargs):
        payment = self.get_object()
        if not payment.receipt:
            from rest_framework.exceptions import NotFound
            raise NotFound("No receipt was uploaded.")
        response = HttpResponse(bytes(payment.receipt), content_type=payment.receipt_type)
        response["Content-Disposition"] = 'attachment; filename="receipt"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(request=s.PaymentReviewSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None, **kwargs):
        self.access.require("manage_finance")
        data = validate_input(s.PaymentReviewSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            payment = self.get_object()
            payload = finance.payment_preview(payment, data["decision"], data["reason"])
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            finance.review_payment(payment, data["decision"], data["reason"], request.user, data["acknowledge_duplicates"])
            return Response({"data": self.get_serializer(payment).data})


class PayrollViewSet(CreateMixin, ReadViewSet):
    model = m.Payroll
    serializer_class = s.PayrollSerializer
    capability = "manage_finance"

    @extend_schema(request=s.PayrollTransitionSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None, **kwargs):
        self.access.require("manage_finance")
        data = validate_input(s.PayrollTransitionSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            payroll = self.get_object()
            payload = finance.payroll_preview(payroll, data["target"])
            payload["payment_reference"] = data.get("payment_reference", "")
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            finance.transition_payroll(payroll, data["target"], request.user, data.get("payment_reference", ""))
            return Response({"data": self.get_serializer(payroll).data})

    @extend_schema(responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["get"])
    def statement(self, request, pk=None, **kwargs):
        payroll = self.get_object()
        entries = finance.payroll_entries(payroll)
        teacher = request.query_params.get("teacher")
        if teacher:
            from rest_framework.fields import UUIDField
            entries = entries.filter(teacher_id=UUIDField().run_validation(teacher))
        rows = list(entries.values("teacher_id", "teacher__name", "currency").annotate(total=Sum("amount")).order_by("teacher__name", "currency"))
        return Response({"data": {"payroll": self.get_serializer(payroll).data, "statements": rows, "totals": monetary_totals(entries)}})


class EarningEntryViewSet(ReadViewSet):
    model = m.EarningEntry
    serializer_class = s.EarningEntrySerializer

    @extend_schema(request=s.EarningAdjustmentSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"])
    def adjust(self, request, pk=None, **kwargs):
        self.access.require("manage_finance")
        data = validate_input(s.EarningAdjustmentSerializer, request)
        if not data["amount"]:
            raise ValidationError({"amount": "Adjustment cannot be zero."})
        with transaction.atomic():
            lock_academy(self.organization.id)
            original = self.get_object()
            key = f"adjustment:{data['idempotency_key']}"
            existing = m.EarningEntry.objects.filter(organization=self.organization, key=key).first()
            if existing:
                if existing.adjustment_of_id != original.id or existing.amount != data["amount"] or existing.reason != data["reason"]:
                    raise ValidationError("Idempotency key was used for a different adjustment.")
                return Response({"data": self.get_serializer(existing).data})
            payload = {"original_entry": str(original.id), "amount": str(data["amount"]), "currency": original.currency, "teacher": str(original.teacher_id), "reason": data["reason"], "idempotency_key": str(data["idempotency_key"]), "effect": "New adjustment; original payroll remains unchanged."}
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            entry = m.EarningEntry.objects.create(organization=self.organization, teacher=original.teacher, adjustment_of=original, amount=data["amount"], currency=original.currency, earned_on=timezone.localdate(), reason=data["reason"], key=key, actor=request.user)
            history(original, request.user, "adjusted", data["reason"], adjustment=entry.id)
            return Response({"data": self.get_serializer(entry).data})


class EarningsIssueViewSet(CreateMixin, ReadViewSet):
    model = m.EarningsIssue
    serializer_class = s.EarningsIssueSerializer
    capability = "own_earnings"

    @extend_schema(request=s.IssueResolutionSerializer, responses=s.EarningsIssueSerializer)
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None, **kwargs):
        self.access.require("manage_finance")
        data = validate_input(s.IssueResolutionSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            issue = self.get_object()
            if issue.status != "open":
                raise ValidationError("Issue is already resolved.")
            issue.status = "resolved"
            issue.resolution = data["resolution"]
            issue.save()
            history(issue, request.user, "resolved")
            return Response(self.get_serializer(issue).data)


class MessageTemplateViewSet(CrudViewSet):
    model = m.MessageTemplate
    serializer_class = s.MessageTemplateSerializer
    capability = "manage_settings"


class MessageAutomationViewSet(CrudViewSet):
    model = m.MessageAutomation
    serializer_class = s.MessageAutomationSerializer
    capability = "manage_settings"


class MessageViewSet(ReadViewSet):
    model = m.Message
    serializer_class = s.MessageSerializer


class HistoryEventViewSet(ReadViewSet):
    model = m.HistoryEvent
    serializer_class = s.HistoryEventSerializer

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response.data = redact_financial(response.data, self.access)
        return response

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        response.data = redact_financial(response.data, self.access)
        return response


class SessionRequestViewSet(CreateMixin, ReadViewSet):
    model = m.SessionRequest
    serializer_class = s.SessionRequestSerializer
    capability = "request_change"

    def perform_create(self, serializer):
        self.require_write()
        session = serializer.validated_data["session"]
        if session.status != "scheduled":
            raise ValidationError("Only scheduled classes accept change requests.")
        if serializer.validated_data["kind"] == "reschedule" and not serializer.validated_data.get("proposed_start"):
            raise ValidationError({"proposed_start": "Choose the requested start time."})
        policy = sessions.cancellation_policy(session)
        obj = serializer.save(organization=self.organization, requested_by=self.request.user, policy_snapshot=policy)
        history(obj, self.request.user, "requested")

    @extend_schema(request=s.RequestReviewSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None, **kwargs):
        self.access.require("manage_schedule")
        data = validate_input(s.RequestReviewSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            item = self.get_object()
            if item.status != "pending":
                raise ValidationError("This request has already been reviewed.")
            change = {"action": "cancel" if item.kind == "cancel" else "reschedule", "reason": data["reason"], "initiator": "family", "notify_family": True, "acknowledge_warnings": data["acknowledge_warnings"]}
            if item.kind == "cancel":
                # Preserve the policy at submission; staff response time must not
                # turn an on-time family request into a late cancellation.
                change.update({key: item.policy_snapshot[key] for key in ["deduct_student", "pay_teacher"]})
                change["policy_snapshot"] = item.policy_snapshot
            else:
                change["starts_at"] = item.proposed_start
            payload = {"request": str(item.id), "decision": data["decision"], "reason": data["reason"], "submitted_policy": item.policy_snapshot}
            if data["decision"] == "approved":
                payload["session_change"] = sessions.session_action_preview(item.session, change)
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            if data["decision"] == "approved":
                sessions.apply_session_action(item.session, change, request.user)
            item.status = data["decision"]
            item.reviewed_by = request.user
            item.save()
            history(item, request.user, data["decision"], data["reason"])
            return Response({"data": self.get_serializer(item).data})


class ImportJobViewSet(ReadViewSet):
    model = m.ImportJob
    serializer_class = s.ImportJobSerializer

    @extend_schema(request=s.FileUploadSerializer, responses={201: s.ImportJobSerializer})
    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload(self, request, **kwargs):
        self.access.require("import")
        data = validate_input(s.FileUploadSerializer, request)
        columns, rows = imports.read_upload(data["file"])
        job = m.ImportJob.objects.create(organization=self.organization, created_by=request.user, filename=data["file"].name[:200], columns=columns, rows=rows)
        return Response(self.get_serializer(job).data, status=201)

    @extend_schema(request=s.ImportMapSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None, **kwargs):
        self.access.require("import")
        data = validate_input(s.ImportMapSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            job = self.get_object()
            if job.status == "imported":
                raise ValidationError("This file was already imported.")
            rows, errors = imports.validate_import(job, data["mapping"])
            job.mapping = data["mapping"]
            job.errors = errors
            job.status = "validated" if not errors else "uploaded"
            job.save()
            return Response({"data": {"job": self.get_serializer(job).data, "valid_rows": len(rows), "preview": rows[:100], "preview_limit": 100, "errors": errors}})

    @extend_schema(request=s.ImportConfirmSerializer, responses=s.JsonResponseSerializer)
    @action(detail=True, methods=["post"], url_path="execute")
    def execute(self, request, pk=None, **kwargs):
        self.access.require("import")
        data = validate_input(s.ImportConfirmSerializer, request)
        with transaction.atomic():
            lock_academy(self.organization.id)
            job = self.get_object()
            if job.status == "imported":
                return Response({"data": self.get_serializer(job).data})
            if job.status != "validated":
                raise ValidationError("Map columns and resolve validation errors first.")
            rows, errors = imports.validate_import(job, job.mapping)
            if errors:
                raise ValidationError({"rows": [str(item) for item in errors]})
            payload = {"job": str(job.id), "updated_at": str(job.updated_at), "rows": len(rows), "mapping": job.mapping, "effect": "Create students and link existing families by external ID."}
            response = confirmation(payload, data, self.access)
            if response is not None:
                return response
            imports.execute_import(job, request.user)
            return Response({"data": self.get_serializer(job).data})

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
    @action(detail=True, methods=["get"], url_path="error-report")
    def error_report(self, request, pk=None, **kwargs):
        job = self.get_object()
        body = imports.safe_csv([["row", "message"]] + [[row["row"], row["message"]] for row in job.errors])
        response = HttpResponse(body, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="import-errors.csv"'
        return response


class WorkspaceDashboardViewSet(TenantViewSet):
    serializer_class = s.JsonResponseSerializer
    model = m.Session

    @extend_schema(responses=s.JsonResponseSerializer)
    @action(detail=False, methods=["get"])
    def overview(self, request, **kwargs):
        from .validators import validate_timezone
        zone_name = request.query_params.get("timezone") or settings_for(self.organization).timezone
        validate_timezone(zone_name)
        zone = ZoneInfo(zone_name)
        now = timezone.now()
        today = now.astimezone(zone).date()
        start = datetime.combine(today, time(), zone)
        end = datetime.combine(today + timedelta(days=1), time(), zone)
        queryset = self.access.sessions()
        attention = [{"key": "needs_review", "count": queryset.filter(status="needs_review").count(), "resource": "sessions", "filters": {"status": "needs_review"}}]
        if self.access.workspace == "management":
            attention.append({"key": "pending_requests", "count": m.SessionRequest.objects.filter(organization=self.organization, status="pending").count(), "resource": "session-requests", "filters": {"status": "pending"}})
            attention.append({"key": "message_problems", "count": m.Message.objects.filter(organization=self.organization, status="action_required").count(), "resource": "messages", "filters": {"status": "action_required"}})
            if "view_finance" in self.access.capabilities:
                attention.append({"key": "pending_payments", "count": m.Payment.objects.filter(organization=self.organization, status="pending").count(), "resource": "payments", "filters": {"status": "pending"}})
        next_session = queryset.filter(status="scheduled", ends_at__gt=now).select_related("student__family", "teacher", "enrollment").order_by("starts_at").first()
        today_sessions = queryset.filter(starts_at__gte=start, starts_at__lt=end).select_related("student__family", "teacher", "enrollment")
        context = self.get_serializer_context()
        data = {"workspace": self.access.workspace, "timezone": zone_name, "server_now": now, "needs_attention": attention, "statistics": [{"key": "students", "count": self.access.students().count(), "resource": "students", "filters": {}}, {"key": "today_sessions", "count": today_sessions.count(), "resource": "sessions", "filters": {"starts_after": start.isoformat(), "starts_before": end.isoformat()}}], "next_session": s.SessionSerializer(next_session, context=context).data if next_session else None, "countdown_seconds": max(0, int((next_session.starts_at - now).total_seconds())) if next_session else None, "today_sessions": s.SessionSerializer(today_sessions[:100], many=True, context=context).data}
        if self.access.workspace == "family":
            data["students"] = s.StudentSerializer(self.access.students(), many=True, context=context).data
            data["enrollments"] = s.EnrollmentSerializer(m.Enrollment.objects.filter(student__in=self.access.students()).exclude(status="closed"), many=True, context=context).data
        if self.access.workspace == "management":
            data["whatsapp_status"] = settings_for(self.organization).whatsapp_status
        return Response({"data": data})

    def report_data(self, request):
        self.access.require("reports")
        from rest_framework.fields import DateField
        today = timezone.localdate()
        start = DateField().run_validation(request.query_params.get("from", today.replace(day=1).isoformat()))
        end = DateField().run_validation(request.query_params.get("to", today.isoformat()))
        if end < start or (end - start).days > 366:
            raise ValidationError("Choose a report interval of at most 366 days.")
        zone_name = settings_for(self.organization).timezone
        zone = ZoneInfo(zone_name)
        lower = datetime.combine(start, time(), zone)
        upper = datetime.combine(end + timedelta(days=1), time(), zone)
        classes = self.access.sessions().filter(starts_at__gte=lower, starts_at__lt=upper)
        report = {"from": str(start), "to": str(end), "timezone": zone_name, "definitions": {"completed_sessions": "Sessions with reviewed reports and status completed, by scheduled academy-local date.", "attendance_rate": "Present or late completed sessions divided by all completed sessions; null if none.", "approved_payments": "Approved payment amounts by review date; grouped by currency.", "teacher_earnings": "Net earnings and adjustments by earned_on date; grouped by currency."}, "completed_sessions": classes.filter(status="completed").count(), "attendance_rate": None, "session_statuses": list(classes.values("status").annotate(count=Count("id")).order_by("status"))}
        if report["completed_sessions"]:
            report["attendance_rate"] = classes.filter(status="completed", attendance__in=["present", "late"]).count() / report["completed_sessions"]
        if "view_finance" in self.access.capabilities:
            report["approved_payments"] = monetary_totals(m.Payment.objects.filter(organization=self.organization, status="approved", reviewed_at__gte=lower, reviewed_at__lt=upper))
            report["teacher_earnings"] = monetary_totals(m.EarningEntry.objects.filter(organization=self.organization, earned_on__gte=start, earned_on__lte=end))
        return report

    @extend_schema(responses=s.JsonResponseSerializer)
    @action(detail=False, methods=["get"])
    def reports(self, request, **kwargs):
        return Response({"data": self.report_data(request)})

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
    @action(detail=False, methods=["get"], url_path="export-report")
    def export_report(self, request, **kwargs):
        report = self.report_data(request)
        rows = [["metric", "value", "currency", "definition"], ["completed_sessions", report["completed_sessions"], "", report["definitions"]["completed_sessions"]], ["attendance_rate", report["attendance_rate"], "", report["definitions"]["attendance_rate"]]]
        for metric in ("approved_payments", "teacher_earnings"):
            for group in report.get(metric, []):
                rows.append([metric, group["total"], group["currency"], report["definitions"][metric]])
        response = HttpResponse(imports.safe_csv(rows), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="academy-report.csv"'
        return response


class AcademyMemberViewSet(TenantViewSet):
    serializer_class = s.AcademyMemberSerializer

    def get_queryset(self):
        from apps.organizations.models import OrganizationMember
        if getattr(self, "swagger_fake_view", False):
            return OrganizationMember.objects.none()
        self.access.require("manage_roles")
        return OrganizationMember.objects.filter(organization=self.organization).select_related("user")

    @extend_schema(responses=s.AcademyMemberSerializer(many=True))
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @extend_schema(request=s.MemberInviteSerializer, responses={201: s.AcademyMemberSerializer})
    def create(self, request, *args, **kwargs):
        from apps.accounts.models import User
        from apps.organizations.models import OrganizationMember
        self.access.require("manage_roles")
        data = validate_input(s.MemberInviteSerializer, request)
        email = data["email"].strip().lower()
        with transaction.atomic():
            lock_academy(self.organization.id)
            user = User.objects.filter(email__iexact=email, phone=data["phone"]).first()
            if user is None:
                if User.objects.filter(Q(email__iexact=email) | Q(phone=data["phone"])).exists():
                    raise ValidationError("Email and phone do not identify the same account.")
                user = User.objects.create_user(email=email, phone=data["phone"], first_name=data.get("first_name", ""), last_name=data.get("last_name", ""), status="pending")
            if not user.is_active or user.status not in {"active", "pending"}:
                raise ValidationError("This account cannot be added to an academy.")
            member, created = OrganizationMember.objects.get_or_create(organization=self.organization, user=user, defaults={"role": data["role"]})
            if not created and member.role != data["role"]:
                raise ValidationError("Membership already exists with a different role.")
            m.HistoryEvent.objects.create(organization=self.organization, actor=request.user, entity="membership", entity_id=member.id, action="provisioned", data={"user": str(user.id), "role": member.role})
            return Response(self.get_serializer(member).data, status=201)
