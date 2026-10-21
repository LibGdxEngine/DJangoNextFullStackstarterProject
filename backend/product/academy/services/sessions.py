from datetime import timedelta
from decimal import Decimal
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from .. import models as m
from .common import settings_for, history, balance
from .scheduling import booking_warnings, zoned_times
from .finance import financial_preview, apply_financials


def cancellation_policy(session, initiator="family"):
    settings = settings_for(session.organization)
    late = session.starts_at - timezone.now() < timedelta(hours=settings.cancellation_hours)
    charge = initiator == "family" and late
    return {"initiator": initiator, "late": late, "notice_hours": settings.cancellation_hours, "deduct_student": charge and settings.late_cancel_deduct, "pay_teacher": charge and settings.late_cancel_pay_teacher, "policy_text": f"Cancellations require {settings.cancellation_hours} hours notice. This request {'will' if charge and settings.late_cancel_deduct else 'will not'} deduct one lesson if approved."}


def session_action_preview(session, data):
    action = data["action"]
    payload = {"session": str(session.id), "version": session.version, "action": action, "reason": data["reason"], "notify_family": data.get("notify_family", True), "old_times": zoned_times(session.starts_at, session.ends_at, session.student, session.teacher)}
    if action in {"cancel", "reschedule", "substitute"} and session.status != "scheduled":
        raise ValidationError("Only scheduled sessions can be cancelled, moved or substituted.")
    if action == "approve_report" and session.status != "needs_review":
        raise ValidationError("Submit a lesson report before approving the session.")
    if action == "correct_attendance" and session.status != "completed":
        raise ValidationError("Only completed sessions can have attendance corrected.")
    if action in {"cancel", "approve_report", "correct_attendance"}:
        if "deduct_student" not in data or "pay_teacher" not in data:
            raise ValidationError("Make separate student-deduction and teacher-pay decisions.")
        payload["financial_effects"] = financial_preview(session, data["deduct_student"], data["pay_teacher"])
        if action == "cancel":
            payload["policy"] = data.get("policy_snapshot") or cancellation_policy(session, data.get("initiator", "academy"))
        if action == "correct_attendance":
            if "attendance" not in data:
                raise ValidationError({"attendance": "Choose corrected attendance."})
            payload["original_attendance"] = session.attendance
            payload["new_attendance"] = data["attendance"]
    if action in {"reschedule", "substitute"}:
        start = data.get("starts_at", session.starts_at)
        end = start + (session.ends_at - session.starts_at)
        teacher = data.get("teacher", session.teacher)
        if action == "reschedule" and "starts_at" not in data or action == "substitute" and "teacher" not in data:
            raise ValidationError("Provide a new start time or substitute teacher.")
        if start <= timezone.now():
            raise ValidationError({"starts_at": "Choose a future class time."})
        warnings = booking_warnings(session.student, teacher, session.enrollment, start, end, [session.id])
        payload.update({"new_times": zoned_times(start, end, session.student, teacher), "new_teacher": str(teacher.id), "warnings": warnings})
        if action == "substitute":
            from .finance import rate_for
            candidate = m.Session(organization=session.organization, student=session.student, teacher=teacher, enrollment=session.enrollment, starts_at=start, ends_at=end)
            amount, currency = rate_for(candidate)
            payload["substitute_rate"] = {"amount": str(amount), "currency": currency}
    return payload


def apply_session_action(session, data, actor):
    preview = session_action_preview(session, data)
    if any(w["blocking"] for w in preview.get("warnings", [])):
        raise ValidationError({"warnings": [w["message"] for w in preview["warnings"] if w["blocking"]]})
    if preview.get("warnings") and not data.get("acknowledge_warnings"):
        raise ValidationError({"acknowledge_warnings": "Acknowledge the availability warnings."})
    action = data["action"]
    if action in {"cancel", "approve_report", "correct_attendance"}:
        apply_financials(session, data["deduct_student"], data["pay_teacher"], data["reason"], actor)
        session.status = "cancelled" if action == "cancel" else "completed"
        if action == "correct_attendance":
            session.attendance = data["attendance"]
    elif action == "reschedule":
        duration = session.ends_at - session.starts_at
        session.starts_at = data["starts_at"]
        session.ends_at = session.starts_at + duration
    elif action == "substitute":
        session.teacher = data["teacher"]
        session.meeting_url = session.teacher.meeting_url
    session.version += 1
    session.save()
    history(session, actor, action, data["reason"], preview=preview)
    if action in {"cancel", "reschedule", "substitute"}:
        m.Message.objects.filter(session=session, status="queued").update(status="cancelled")
        if data.get("notify_family", True):
            from .messaging import queue_event
            queue_event(session.student, "session_changed", f"changed:{session.id}:v{session.version}", session=session)
    return session


def submit_report(session, values, actor):
    if session.status != "scheduled":
        raise ValidationError("A report already exists or this session is no longer scheduled.")
    if session.starts_at > timezone.now():
        raise ValidationError("A future class cannot be completed.")
    session.attendance = values["attendance"]
    session.actual_minutes = values["actual_minutes"]
    session.late_minutes = values.get("late_minutes", 0)
    if session.late_minutes > session.actual_minutes:
        raise ValidationError({"late_minutes": "Late minutes cannot exceed actual lesson minutes."})
    if session.attendance in {"present", "late"} and not session.actual_minutes:
        raise ValidationError({"actual_minutes": "Enter the actual lesson duration."})
    session.status = "needs_review"
    session.version += 1
    session.save()
    record = m.LessonRecord.objects.create(organization=session.organization, session=session, author=actor, **{key: values.get(key, "") for key in ["family_notes", "internal_notes", "homework"]})
    for item in values.get("progress", []):
        m.QuranProgress.objects.create(organization=session.organization, lesson=record, **item)
    history(session, actor, "report_submitted")
    return record


def archive_preview(student, future_handling, reason):
    sessions = student.sessions.filter(status="scheduled")
    return {"student": str(student.id), "status": student.status, "future_handling": future_handling, "reason": reason, "session_ids": list(map(str, sessions.values_list("id", flat=True))), "versions": list(sessions.values("id", "version")), "remaining_balances": [{"enrollment": str(e.id), "balance": str(balance(e)), "currency": e.currency} for e in student.enrollments.filter(status="active")], "balance_effect": "Balances are retained. Refunds and adjustments require a separate financial action."}


def archive_student(student, future_handling, reason, actor):
    if student.status == "archived":
        raise ValidationError("Student is already archived.")
    sessions = student.sessions.filter(status="scheduled")
    if sessions.exists() and future_handling != "cancel":
        raise ValidationError({"future_handling": "Cancel outstanding sessions before archiving."})
    for session in sessions:
        apply_session_action(session, {"action": "cancel", "reason": reason, "initiator": "academy", "deduct_student": False, "pay_teacher": False, "notify_family": True}, actor)
    student.schedules.filter(is_active=True).update(is_active=False)
    student.status = "archived"
    student.save()
    history(student, actor, "archived", reason)
    return student
