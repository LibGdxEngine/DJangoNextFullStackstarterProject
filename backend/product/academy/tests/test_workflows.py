import io
import uuid
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.models import Sum
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from apps.accounts.models import User, VerificationChallenge
from apps.accounts.services.verification import compute_code_digest
from apps.organizations.models import Organization, OrganizationMember
from product.academy import models as m
from product.academy.services import finance, scheduling
from product.academy.services.common import balance
from product.academy.services.messaging import queue_due_reminders, dispatch_message


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class AcademyFixture(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="owner@academy.test", password="TestPassword123!", status="active", phone="+201011112222")
        self.owner.phone_verified_at = timezone.now()
        self.owner.save()
        self.teacher_user = User.objects.create_user(email="teacher@academy.test", password="TestPassword123!", status="active", phone="+201033334444")
        self.parent = User.objects.create_user(email="parent@academy.test", password="TestPassword123!", status="active", phone="+201022223333")
        self.coordinator = User.objects.create_user(email="coordinator@academy.test", password="TestPassword123!", status="active", phone="+201044445555")
        self.org = Organization.objects.create(name="Academy", slug="test-academy")
        for user, role in [(self.owner, "OWNER"), (self.teacher_user, "MEMBER"), (self.parent, "MEMBER"), (self.coordinator, "MEMBER")]:
            OrganizationMember.objects.create(organization=self.org, user=user, role=role)
        self.settings = m.AcademySettings.objects.create(organization=self.org, timezone="UTC")
        m.StaffRole.objects.create(organization=self.org, user=self.coordinator, role="coordinator")
        self.family = m.Family.objects.create(organization=self.org, name="Family", timezone="Europe/London")
        m.FamilyContact.objects.create(organization=self.org, family=self.family, name="Parent", user=self.parent, phone="+201022223333")
        self.teacher = m.Teacher.objects.create(organization=self.org, name="Teacher", user=self.teacher_user, timezone="Africa/Cairo", meeting_url="https://example.com/class")
        self.rate = m.TeacherRate.objects.create(organization=self.org, teacher=self.teacher, amount="12.00", currency="USD", effective_from=date(2020, 1, 1))
        self.student = m.Student.objects.create(organization=self.org, family=self.family, teacher=self.teacher, name="Student", timezone="Europe/London")
        self.package = m.Package.objects.create(organization=self.org, name="Four classes", lesson_count=4, duration_minutes=30, validity_days=365, price="80.00", currency="USD")
        self.enrollment = finance.purchase(self.student, self.package, timezone.localdate() - timedelta(days=30), self.owner)
        finance.activate_enrollment(self.enrollment, self.owner)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.base = f"/api/product/academy/{self.org.id}/"

    def post(self, route, data, code=200):
        response = self.client.post(self.base + route, data, format="json")
        self.assertEqual(response.status_code, code, getattr(response, "data", response.content))
        return response

    def confirm(self, route, data):
        preview = self.post(route, data)
        self.assertIn("preview_token", preview.data)
        return self.post(route, {**data, "preview_token": preview.data["preview_token"]})

    def make_session(self, days=-1, **kwargs):
        start = timezone.now() + timedelta(days=days)
        return m.Session.objects.create(organization=self.org, student=self.student, teacher=self.teacher, enrollment=self.enrollment, starts_at=start, ends_at=start + timedelta(minutes=30), **kwargs)

    def report_and_approve(self, session):
        self.post(f"sessions/{session.id}/lesson-report/", {"attendance": "present", "actual_minutes": 30, "family_notes": "Good progress", "internal_notes": "Private observation", "progress": [{"surah": 1, "ayah_from": 1, "ayah_to": 7, "activity": "recitation", "rating": 4}]}, 201)
        self.confirm(f"sessions/{session.id}/transition/", {"action": "approve_report", "reason": "Reviewed", "deduct_student": True, "pay_teacher": True})
        session.refresh_from_db()
        return session


class AcademyWorkflowTests(AcademyFixture):
    def test_complete_cycle_payment_schedule_report_payroll_and_renewal(self):
        enrollment = self.post("enrollments/", {"student": str(self.student.id), "package": str(self.package.id), "starts_on": str(timezone.localdate() - timedelta(days=2))}, 201).data
        payment = self.post("payments/", {"enrollment": enrollment["id"], "amount": "80.00", "currency": "USD", "reference": "bank-1"}, 201).data
        self.confirm(f"payments/{payment['id']}/review/", {"decision": "approved", "reason": "Bank transfer verified"})
        purchased = m.Enrollment.objects.get(pk=enrollment["id"])
        self.assertEqual(balance(purchased), 4)
        day = timezone.localdate() - timedelta(days=1)
        schedule = self.post("schedules/", {"student": str(self.student.id), "teacher": str(self.teacher.id), "enrollment": enrollment["id"], "timezone": "UTC", "weekdays": [day.weekday()], "local_time": "10:00", "starts_on": str(day), "ends_on": str(day), "duration_minutes": 30, "acknowledge_warnings": True}, 201)
        session = m.Session.objects.get(series_id=schedule.data["id"])
        self.report_and_approve(session)
        self.assertEqual(balance(purchased), 3)
        self.assertEqual(m.EarningEntry.objects.get(session=session).amount, Decimal("12.00"))
        payroll = self.post("payroll/", {"month": str(timezone.localdate().replace(day=1))}, 201).data
        for target in ["reviewed", "approved", "paid"]:
            self.confirm(f"payroll/{payroll['id']}/transition/", {"target": target, "payment_reference": "payroll-bank-1"})
        self.assertEqual(m.Payroll.objects.get(pk=payroll["id"]).status, "paid")
        renewed = self.post("enrollments/", {"student": str(self.student.id), "package": str(self.package.id), "starts_on": str(timezone.localdate()), "renewed_from": enrollment["id"]}, 201)
        self.assertEqual(str(renewed.data["renewed_from"]), enrollment["id"])
        self.assertEqual(renewed.data["balance"], "0")
        self.assertTrue(m.HistoryEvent.objects.filter(entity_id=session.id, action="approve_report").exists())

    def test_catalog_edits_do_not_change_purchased_terms(self):
        self.package.lesson_count, self.package.price = 12, Decimal("200")
        self.package.save()
        self.enrollment.refresh_from_db()
        self.assertEqual(self.enrollment.lesson_count, 4)
        self.assertEqual(self.enrollment.price, Decimal("80"))

    def test_report_does_not_apply_financial_effects_until_approved(self):
        session = self.make_session()
        self.post(f"sessions/{session.id}/lesson-report/", {"attendance": "absent", "actual_minutes": 0}, 201)
        self.assertEqual(balance(self.enrollment), 4)
        self.assertFalse(m.EarningEntry.objects.exists())
        self.confirm(f"sessions/{session.id}/transition/", {"action": "approve_report", "reason": "Excused absence", "deduct_student": False, "pay_teacher": True})
        self.assertEqual(balance(self.enrollment), 4)
        self.assertEqual(m.EarningEntry.objects.get().amount, Decimal("12"))

    def test_double_approval_cannot_double_deduct(self):
        session = self.report_and_approve(self.make_session())
        self.post(f"sessions/{session.id}/transition/", {"action": "approve_report", "reason": "Retry", "deduct_student": True, "pay_teacher": True}, 400)
        self.assertEqual(balance(self.enrollment), 3)

    def test_insufficient_balance_rolls_back_entire_approval(self):
        m.BalanceEntry.objects.create(organization=self.org, enrollment=self.enrollment, delta=-4, key="zero", reason="Fixture")
        session = self.make_session()
        self.post(f"sessions/{session.id}/lesson-report/", {"attendance": "present", "actual_minutes": 30}, 201)
        data = {"action": "approve_report", "reason": "Reviewed", "deduct_student": True, "pay_teacher": True}
        preview = self.post(f"sessions/{session.id}/transition/", data)
        self.post(f"sessions/{session.id}/transition/", {**data, "preview_token": preview.data["preview_token"]}, 400)
        session.refresh_from_db()
        self.assertEqual(session.status, "needs_review")
        self.assertFalse(m.EarningEntry.objects.exists())

    def test_closed_payroll_correction_is_new_adjustment(self):
        session = self.report_and_approve(self.make_session())
        payroll = m.Payroll.objects.create(organization=self.org, month=timezone.localdate().replace(day=1))
        finance.transition_payroll(payroll, "reviewed", self.owner)
        finance.transition_payroll(payroll, "approved", self.owner)
        original = m.EarningEntry.objects.get(session=session)
        self.confirm(f"sessions/{session.id}/transition/", {"action": "correct_attendance", "attendance": "absent", "reason": "Corrected mistaken attendance", "deduct_student": False, "pay_teacher": False})
        original.refresh_from_db()
        self.assertEqual(original.amount, Decimal("12"))
        self.assertEqual(original.payroll_id, payroll.id)
        adjustment = m.EarningEntry.objects.get(adjustment_of=original)
        self.assertEqual(adjustment.amount, Decimal("-12"))
        self.assertIsNone(adjustment.payroll_id)
        self.assertEqual(balance(self.enrollment), 4)

    def test_balance_adjustment_is_idempotent_and_requires_preview(self):
        data = {"delta": "2.00", "reason": "Goodwill", "idempotency_key": str(uuid.uuid4())}
        self.confirm(f"enrollments/{self.enrollment.id}/adjust-balance/", data)
        self.post(f"enrollments/{self.enrollment.id}/adjust-balance/", data)
        self.assertEqual(balance(self.enrollment), 6)
        self.post(f"enrollments/{self.enrollment.id}/adjust-balance/", {**data, "delta": "3"}, 400)

    def test_stale_preview_rejected_after_balance_change(self):
        session = self.make_session(days=2)
        data = {"action": "cancel", "reason": "Requested", "deduct_student": True, "pay_teacher": False}
        preview = self.post(f"sessions/{session.id}/transition/", data)
        m.BalanceEntry.objects.create(organization=self.org, enrollment=self.enrollment, delta=1, key="extra", reason="Added")
        self.post(f"sessions/{session.id}/transition/", {**data, "preview_token": preview.data["preview_token"]}, 400)
        session.refresh_from_db()
        self.assertEqual(session.status, "scheduled")

    def test_payroll_cannot_skip_review(self):
        payroll = m.Payroll.objects.create(organization=self.org, month=timezone.localdate().replace(day=1))
        self.post(f"payroll/{payroll.id}/transition/", {"target": "approved"}, 400)

    def test_reports_keep_currencies_separate(self):
        for currency in ["USD", "EGP"]:
            m.EarningEntry.objects.create(organization=self.org, teacher=self.teacher, amount=10, currency=currency, earned_on=timezone.localdate(), reason="Bonus", key=currency)
        report = self.client.get(self.base + "dashboard/reports/")
        self.assertEqual(report.status_code, 200)
        self.assertEqual({row["currency"] for row in report.data["data"]["teacher_earnings"]}, {"USD", "EGP"})

    def test_financial_ledgers_have_no_direct_mutation_routes(self):
        entry = self.enrollment.ledger.first()
        self.assertEqual(self.client.post(self.base + "balance-entries/", {}, format="json").status_code, 405)
        self.assertEqual(self.client.patch(self.base + f"balance-entries/{entry.id}/", {"delta": 100}, format="json").status_code, 405)

    def test_preview_gets_actual_financial_rate_for_substitute(self):
        session = self.make_session(days=2)
        teacher = m.Teacher.objects.create(organization=self.org, name="Substitute", timezone="UTC")
        m.TeacherRate.objects.create(organization=self.org, teacher=teacher, amount=20, currency="EUR", effective_from=date(2020, 1, 1))
        response = self.post(f"sessions/{session.id}/transition/", {"action": "substitute", "teacher": str(teacher.id), "reason": "Cover"})
        self.assertEqual(response.data["data"]["substitute_rate"]["currency"], "EUR")


class AcademyPermissionsTests(AcademyFixture):
    def test_tenant_isolation_and_foreign_key_rejection(self):
        other = Organization.objects.create(name="Other", slug="other")
        family = m.Family.objects.create(organization=other, name="Secret")
        self.assertEqual(self.client.get(f"/api/product/academy/{other.id}/families/").status_code, 403)
        self.assertEqual(self.client.get(self.base + f"families/{family.id}/").status_code, 404)
        self.post("students/", {"name": "Cross tenant", "family": str(family.id)}, 400)
        with self.assertRaises(DjangoValidationError):
            m.Student.objects.create(organization=self.org, family=family, name="Cross tenant")

    def test_coordinator_cannot_see_rates_or_modify_money(self):
        session = self.make_session(days=2)
        self.client.force_authenticate(self.coordinator)
        self.assertEqual(self.client.get(self.base + "teacher-rates/").status_code, 403)
        self.assertEqual(self.client.get(self.base + "earnings/").status_code, 403)
        self.post("packages/", {"name": "Forbidden"}, 400)
        preview = self.post(f"sessions/{session.id}/transition/", {"action": "cancel", "reason": "Request", "deduct_student": False, "pay_teacher": True})
        self.assertNotIn("teacher_amount", preview.data["data"]["financial_effects"])

    def test_teacher_sees_only_assigned_sessions(self):
        own = self.make_session()
        other_teacher = m.Teacher.objects.create(organization=self.org, name="Other")
        other_session = self.make_session(days=1)
        other_session.teacher = other_teacher
        other_session.save()
        self.client.force_authenticate(self.teacher_user)
        response = self.client.get(self.base + "sessions/")
        self.assertEqual([row["id"] for row in response.data["results"]], [str(own.id)])
        self.assertEqual(self.client.get(self.base + f"sessions/{other_session.id}/").status_code, 404)
        self.post(f"sessions/{other_session.id}/lesson-report/", {"attendance": "present", "actual_minutes": 30}, 404)

    def test_family_cannot_read_internal_notes_or_other_family(self):
        session = self.report_and_approve(self.make_session())
        m.StudentNote.objects.create(organization=self.org, student=self.student, author=self.owner, visibility="internal", text="Secret staff note")
        other_family = m.Family.objects.create(organization=self.org, name="Other family")
        other_student = m.Student.objects.create(organization=self.org, family=other_family, name="Other student")
        self.client.force_authenticate(self.parent)
        records = self.client.get(self.base + "lesson-records/")
        self.assertNotIn("internal_notes", records.data["results"][0])
        self.assertEqual(self.client.get(self.base + "student-notes/").data["count"], 0)
        self.assertEqual(self.client.get(self.base + f"students/{other_student.id}/").status_code, 404)
        self.post(f"sessions/{session.id}/transition/", {"action": "correct_attendance", "attendance": "absent", "reason": "No", "deduct_student": False, "pay_teacher": False}, 403)

    def test_workspace_switch_does_not_escalate_permissions(self):
        self.client.force_authenticate(self.parent)
        response = self.client.get(self.base + "students/", HTTP_X_ACADEMY_WORKSPACE="management")
        self.assertEqual(response.status_code, 403)

    def test_adult_student_does_not_gain_siblings_access(self):
        adult = m.Student.objects.create(organization=self.org, family=self.family, name="Adult", is_adult=True, user=self.teacher_user)
        self.client.force_authenticate(self.teacher_user)
        response = self.client.get(self.base + "students/", HTTP_X_ACADEMY_WORKSPACE="family")
        self.assertEqual([row["id"] for row in response.data["results"]], [str(adult.id)])

    def test_anonymous_academy_access_is_rejected(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.base + "students/").status_code, 401)


class SchedulingTests(AcademyFixture):
    def test_local_time_stays_fixed_across_dst(self):
        self.enrollment.starts_on = date(2026, 3, 1)
        self.enrollment.expires_on = date(2026, 4, 30)
        self.enrollment.save()
        series = m.RecurringSchedule(organization=self.org, student=self.student, teacher=self.teacher, enrollment=self.enrollment, timezone="Europe/London", weekdays=[6], local_time=time(10), starts_on=date(2026, 3, 22), ends_on=date(2026, 3, 29), duration_minutes=30)
        preview = scheduling.schedule_preview(series)
        self.assertIn("10:00:00+00:00", preview["dates"][0]["starts_at"])
        self.assertIn("09:00:00+00:00", preview["dates"][1]["starts_at"])
        self.assertTrue(any(w["code"] == "dst_shift" for w in preview["dates"][1]["warnings"]))
        self.assertEqual(set(preview["dates"][0]["times"]), {"academy", "family", "teacher"})

    def test_dst_nonexistent_and_ambiguous_times_rejected(self):
        from rest_framework.exceptions import ValidationError
        for day, clock in [(date(2026, 3, 29), time(1, 30)), (date(2026, 10, 25), time(1, 30))]:
            with self.assertRaises(ValidationError):
                scheduling.local_instant(day, clock, "Europe/London")

    def test_conflict_blocks_reschedule_and_preview_identifies_session(self):
        session = self.make_session(days=2)
        conflict = self.make_session(days=3)
        data = {"action": "reschedule", "reason": "Move", "starts_at": conflict.starts_at.isoformat(), "acknowledge_warnings": True}
        preview = self.post(f"sessions/{session.id}/transition/", data)
        warnings = preview.data["data"]["warnings"]
        self.assertIn(str(conflict.id), next(w for w in warnings if w["code"] == "conflict")["session_ids"])
        self.post(f"sessions/{session.id}/transition/", {**data, "preview_token": preview.data["preview_token"]}, 400)

    def test_bulk_action_has_exact_ids_and_is_atomic(self):
        first, second = self.make_session(days=2), self.make_session(days=3)
        data = {"action": "cancel", "reason": "Holiday", "session_ids": [str(first.id), str(second.id)], "deduct_student": False, "pay_teacher": False}
        preview = self.post("sessions/bulk-transition/", data)
        self.assertEqual({v["session"] for v in preview.data["data"]["sessions"]}, {str(first.id), str(second.id)})
        self.post("sessions/bulk-transition/", {**data, "preview_token": preview.data["preview_token"]})
        self.assertEqual(m.Session.objects.filter(status="cancelled").count(), 2)

    def test_family_cancellation_uses_policy_at_submission(self):
        session = self.make_session(days=2)
        self.client.force_authenticate(self.parent)
        request = self.post("session-requests/", {"session": str(session.id), "kind": "cancel", "reason": "Travel"}, 201)
        item = m.SessionRequest.objects.get(pk=request.data["id"])
        self.assertFalse(item.policy_snapshot["deduct_student"])
        session.starts_at = timezone.now() + timedelta(hours=1)
        session.ends_at = session.starts_at + timedelta(minutes=30)
        session.save()
        self.client.force_authenticate(self.owner)
        self.confirm(f"session-requests/{item.id}/review/", {"decision": "approved", "reason": "Accepted"})
        self.assertEqual(balance(self.enrollment), 4)
