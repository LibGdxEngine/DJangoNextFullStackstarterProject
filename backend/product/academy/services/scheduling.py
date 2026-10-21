from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from .. import models as m
from .common import lock_academy, history, balance, settings_for


def local_instant(day, clock, zone):
    naive = datetime.combine(day, clock)
    tz = ZoneInfo(zone)
    candidates = []
    for fold in (0, 1):
        value = naive.replace(tzinfo=tz, fold=fold)
        utc = value.astimezone(dt_timezone.utc)
        if utc.astimezone(tz).replace(tzinfo=None) == naive and utc not in candidates:
            candidates.append(utc)
    if len(candidates) != 1:
        raise ValidationError({"local_time": f"{day} {clock} is {'ambiguous' if candidates else 'nonexistent'} in {zone}. Choose another time."})
    return candidates[0]


def zoned_times(start, end, student, teacher):
    academy = settings_for(student.organization)
    return {label: {"timezone": zone, "starts_at": start.astimezone(ZoneInfo(zone)).isoformat(), "ends_at": end.astimezone(ZoneInfo(zone)).isoformat()} for label, zone in [("academy", academy.timezone), ("family", student.family.timezone), ("teacher", teacher.timezone)]}


def booking_warnings(student, teacher, enrollment, start, end, exclude_ids=()):
    warnings = []
    if student.status != "active" or not student.family.is_active or not teacher.is_active:
        warnings.append({"code": "inactive_participant", "blocking": True, "message": "Student, family and teacher must be active."})
    conflicts = m.Session.objects.filter(organization_id=student.organization_id, starts_at__lt=end, ends_at__gt=start).exclude(status="cancelled").exclude(pk__in=exclude_ids).filter(Q(student=student) | Q(teacher=teacher))
    if conflicts.exists():
        warnings.append({"code": "conflict", "blocking": True, "message": "Teacher or student already has a class.", "session_ids": list(map(str, conflicts.values_list("id", flat=True)))})
    day = start.astimezone(ZoneInfo(student.timezone)).date()
    if enrollment.student_id != student.pk or enrollment.status != "active" or not enrollment.starts_on <= day <= enrollment.expires_on:
        warnings.append({"code": "package_invalid", "blocking": True, "message": "An active enrollment valid on the student's local class date is required."})
    if int((end - start).total_seconds()) != enrollment.duration_minutes * 60:
        warnings.append({"code": "package_duration", "blocking": True, "message": "Class duration must match the purchased enrollment."})
    available = False
    for slot in teacher.availability.all():
        local_start, local_end = start.astimezone(ZoneInfo(slot.timezone)), end.astimezone(ZoneInfo(slot.timezone))
        if local_start.date() == local_end.date() and local_start.weekday() == slot.weekday and slot.start_time <= local_start.time() and local_end.time() <= slot.end_time:
            available = True
    if not available:
        warnings.append({"code": "availability", "blocking": False, "message": "Outside recorded teacher availability; confirm with the teacher."})
    return warnings


def schedule_preview(series, exclude_ids=()):
    series.full_clean()
    dates, day, offsets = [], series.starts_on, None
    while day <= series.ends_on:
        if day.weekday() in series.weekdays:
            start = local_instant(day, series.local_time, series.timezone)
            end = start + timedelta(minutes=series.duration_minutes)
            zones = zoned_times(start, end, series.student, series.teacher)
            current_offsets = tuple(start.astimezone(ZoneInfo(z)).utcoffset() for z in [series.timezone, series.student.family.timezone, series.teacher.timezone])
            warnings = booking_warnings(series.student, series.teacher, series.enrollment, start, end, exclude_ids)
            if offsets is not None and offsets != current_offsets:
                warnings.append({"code": "dst_shift", "blocking": False, "message": "A UTC offset changes here; review both participants' local times."})
            offsets = current_offsets
            dates.append({"starts_at": start.isoformat(), "ends_at": end.isoformat(), "times": zones, "warnings": warnings})
        day += timedelta(days=1)
    if not dates:
        raise ValidationError({"weekdays": "The selected range contains no classes."})
    reserved = m.Session.objects.filter(enrollment=series.enrollment, status="scheduled").exclude(pk__in=exclude_ids).count()
    remaining = balance(series.enrollment)
    warnings = []
    if len(dates) + reserved > remaining:
        warnings.append({"code": "low_balance", "blocking": False, "message": "Scheduled lessons exceed the current balance. Renewal will be needed."})
    return {"dates": dates, "warnings": warnings, "current_balance": str(remaining), "existing_reserved": reserved, "fixed_timezone": series.timezone}


def require_bookable(preview, acknowledge_warnings):
    warnings = preview["warnings"] + [w for d in preview["dates"] for w in d["warnings"]]
    if any(w["blocking"] for w in warnings):
        raise ValidationError({"schedule": "Resolve blocking warnings before saving.", "warnings": [w["message"] for w in warnings if w["blocking"]]})
    if warnings and not acknowledge_warnings:
        raise ValidationError({"acknowledge_warnings": "Review and acknowledge the schedule warnings."})


@transaction.atomic
def create_schedule(series, actor, acknowledge_warnings=False):
    lock_academy(series.organization_id)
    preview = schedule_preview(series)
    require_bookable(preview, acknowledge_warnings)
    series.save()
    for occurrence in preview["dates"]:
        session = m.Session.objects.create(organization=series.organization, series=series, student=series.student, teacher=series.teacher, enrollment=series.enrollment, starts_at=datetime.fromisoformat(occurrence["starts_at"]), ends_at=datetime.fromisoformat(occurrence["ends_at"]), meeting_url=series.meeting_url or series.teacher.meeting_url)
        history(session, actor, "scheduled")
    history(series, actor, "created", count=len(preview["dates"]))
    return series


@transaction.atomic
def edit_schedule(series, values, scope, from_session, actor, acknowledge_warnings=False, preview_only=False):
    lock_academy(series.organization_id)
    series.refresh_from_db()
    if scope == "this_session":
        raise ValidationError({"scope": "Use the session reschedule preview for one session."})
    selected = series.sessions.all()
    if scope == "this_and_future":
        if not from_session or from_session.series_id != series.id:
            raise ValidationError({"from_session": "Choose a session in this series."})
        selected = selected.filter(starts_at__gte=from_session.starts_at)
    if selected.exclude(status="scheduled").exists():
        raise ValidationError({"scope": "This scope includes completed, reported or cancelled sessions. Choose a future scheduled scope."})
    selected_ids = list(selected.values_list("id", flat=True))
    if not selected_ids:
        raise ValidationError({"scope": "No scheduled sessions to edit."})
    candidate = m.RecurringSchedule(organization=series.organization, **{f: getattr(series, f) for f in ["student", "teacher", "enrollment", "timezone", "weekdays", "local_time", "starts_on", "ends_on", "duration_minutes", "meeting_url"]})
    for key, value in values.items():
        setattr(candidate, key, value)
    if scope == "this_and_future" and candidate.starts_on < from_session.starts_at.astimezone(ZoneInfo(series.timezone)).date():
        raise ValidationError({"starts_on": "The replacement series cannot start before the selected session."})
    preview = schedule_preview(candidate, selected_ids)
    preview["replaced_session_ids"] = list(map(str, selected_ids))
    preview["versions"] = list(selected.values("id", "version"))
    if preview_only:
        return preview
    require_bookable(preview, acknowledge_warnings)
    # Keep old occurrences for audit; replacement series owns the new schedule.
    for session in selected:
        session.status = "cancelled"
        session.version += 1
        session.save()
        history(session, actor, "series_replaced", replacement_series=candidate.id)
        m.Message.objects.filter(session=session, status="queued").update(status="cancelled")
    if scope == "whole_series":
        series.is_active = False
    else:
        series.ends_on = from_session.starts_at.astimezone(ZoneInfo(series.timezone)).date() - timedelta(days=1)
        if series.ends_on < series.starts_on:
            series.is_active = False
            series.ends_on = series.starts_on
    series.save()
    result = create_schedule(candidate, actor, acknowledge_warnings)
    from .messaging import queue_event
    for session in result.sessions.all():
        queue_event(session.student, "session_changed", f"series:{result.id}:{session.id}", session=session)
    return result
