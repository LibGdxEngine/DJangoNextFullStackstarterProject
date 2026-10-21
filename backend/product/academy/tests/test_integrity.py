from concurrent.futures import ThreadPoolExecutor
from datetime import date, time, timedelta
from decimal import Decimal
from django.db import connections, transaction
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.organizations.models import Organization, OrganizationMember
from product.academy import models as m
from product.academy.services.common import balance, lock_academy
from product.academy.services import scheduling
from .test_workflows import AcademyFixture


class IntegrityTests(AcademyFixture):
    def test_member_cannot_modify_organization_through_shared_endpoint(self):
        self.client.force_authenticate(self.parent)
        response = self.client.patch(f"/api/organizations/{self.org.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.org.refresh_from_db()
        self.assertEqual(self.org.name, "Academy")

    def test_generic_crud_persists_tenant_and_restricts_writes(self):
        response = self.post("families/", {"name": "New Family"}, 201)
        self.assertEqual(str(response.data["organization"]), str(self.org.id))
        family_id = response.data["id"]
        response = self.client.patch(self.base + f"families/{family_id}/", {"name": "Updated"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(m.Family.objects.get(pk=family_id).name, "Updated")
        self.client.force_authenticate(self.parent)
        response = self.client.patch(self.base + f"families/{self.family.id}/", {"name": "Forbidden"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_invalid_quran_reference_rolls_back_report(self):
        session = self.make_session()
        self.post(f"sessions/{session.id}/lesson-report/", {"attendance": "present", "actual_minutes": 30, "progress": [{"surah": 1, "ayah_from": 1, "ayah_to": 8, "activity": "recitation", "rating": 4}]}, 400)
        session.refresh_from_db()
        self.assertEqual(session.status, "scheduled")
        self.assertFalse(m.LessonRecord.objects.filter(session=session).exists())

    def test_whole_series_edit_preserves_history_and_replaces_occurrences(self):
        day = timezone.localdate() + timedelta(days=3)
        original = scheduling.create_schedule(m.RecurringSchedule(organization=self.org, student=self.student, teacher=self.teacher, enrollment=self.enrollment, timezone="UTC", weekdays=[day.weekday()], local_time=time(10), starts_on=day, ends_on=day + timedelta(days=7), duration_minutes=30), self.owner, True)
        original_ids = set(original.sessions.values_list("id", flat=True))
        data = {"scope": "whole_series", "changes": {"local_time": "11:00"}, "acknowledge_warnings": True}
        response = self.confirm(f"schedules/{original.id}/edit/", data)
        replacement = m.RecurringSchedule.objects.get(pk=response.data["data"]["id"])
        self.assertEqual(replacement.local_time, time(11))
        self.assertEqual(replacement.sessions.count(), 2)
        self.assertEqual(m.Session.objects.filter(pk__in=original_ids, status="cancelled").count(), 2)
        original.refresh_from_db()
        self.assertFalse(original.is_active)

    def test_this_and_future_edit_does_not_change_earlier_occurrence(self):
        day = timezone.localdate() + timedelta(days=3)
        original = scheduling.create_schedule(m.RecurringSchedule(organization=self.org, student=self.student, teacher=self.teacher, enrollment=self.enrollment, timezone="UTC", weekdays=[day.weekday()], local_time=time(10), starts_on=day, ends_on=day + timedelta(days=7), duration_minutes=30), self.owner, True)
        first, second = list(original.sessions.order_by("starts_at"))
        data = {"scope": "this_and_future", "from_session": str(second.id), "changes": {"starts_on": str(day + timedelta(days=7)), "local_time": "11:00"}, "acknowledge_warnings": True}
        self.confirm(f"schedules/{original.id}/edit/", data)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.status, "scheduled")
        self.assertEqual(second.status, "cancelled")

    def test_archive_preview_keeps_balance_and_cancels_future_classes(self):
        session = self.make_session(days=2)
        self.confirm(f"students/{self.student.id}/archive/", {"reason": "Leaving academy", "future_handling": "cancel"})
        session.refresh_from_db()
        self.student.refresh_from_db()
        self.assertEqual(session.status, "cancelled")
        self.assertEqual(self.student.status, "archived")
        self.assertEqual(balance(self.enrollment), 4)

    def test_bulk_approval_checks_combined_balance(self):
        m.BalanceEntry.objects.create(organization=self.org, enrollment=self.enrollment, delta=-3, reason="One remaining", key="one-left")
        first, second = self.make_session(days=-2), self.make_session(days=-1)
        for session in [first, second]:
            self.post(f"sessions/{session.id}/lesson-report/", {"attendance": "present", "actual_minutes": 30}, 201)
        self.post("sessions/bulk-transition/", {"session_ids": [str(first.id), str(second.id)], "action": "approve_report", "reason": "Review", "deduct_student": True, "pay_teacher": False}, 400)
        self.assertEqual(balance(self.enrollment), 1)
        self.assertEqual(m.Session.objects.filter(status="needs_review").count(), 2)

    def test_payroll_rejects_unresolved_exceptions(self):
        self.make_session(days=-1)
        payroll = m.Payroll.objects.create(organization=self.org, month=timezone.localdate().replace(day=1))
        preview = self.post(f"payroll/{payroll.id}/transition/", {"target": "reviewed"})
        self.assertTrue(preview.data["data"]["pending_session_ids"])
        self.post(f"payroll/{payroll.id}/transition/", {"target": "reviewed", "preview_token": preview.data["preview_token"]}, 400)


class ConcurrentScheduleTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_concurrent_schedule_creation_cannot_double_book(self):
        org = Organization.objects.create(name="Concurrent", slug="concurrent")
        m.AcademySettings.objects.create(organization=org)
        family = m.Family.objects.create(organization=org, name="Family")
        teacher = m.Teacher.objects.create(organization=org, name="Teacher")
        student = m.Student.objects.create(organization=org, family=family, name="Student")
        package = m.Package.objects.create(organization=org, name="Package", lesson_count=2, duration_minutes=30, validity_days=30, price=0, currency="USD")
        day = timezone.localdate() + timedelta(days=1)
        enrollment = m.Enrollment.objects.create(organization=org, student=student, package=package, lesson_count=2, duration_minutes=30, price=0, currency="USD", starts_on=day, expires_on=day + timedelta(days=30), status="active")
        m.BalanceEntry.objects.create(organization=org, enrollment=enrollment, delta=2, reason="Activated", key="activation")
        def book():
            try:
                series = m.RecurringSchedule(organization=org, student=student, teacher=teacher, enrollment=enrollment, timezone="UTC", weekdays=[day.weekday()], local_time=time(10), starts_on=day, ends_on=day, duration_minutes=30)
                scheduling.create_schedule(series, None, True)
                return "booked"
            except ValidationError:
                return "conflict"
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: book(), range(2)))
        self.assertCountEqual(results, ["booked", "conflict"])
        self.assertEqual(m.Session.objects.count(), 1)
