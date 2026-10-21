from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from .. import models as m
from .common import lock_academy, history, balance, settings_for, monetary_totals


def purchase(student, package, starts_on, actor, renewed_from=None):
    if not package.is_active or student.status == "archived":
        raise ValidationError("Choose an active package and a non-archived student.")
    enrollment = m.Enrollment.objects.create(organization_id=student.organization_id, student=student, package=package, renewed_from=renewed_from, lesson_count=package.lesson_count, duration_minutes=package.duration_minutes, price=package.price, currency=package.currency, starts_on=starts_on, expires_on=starts_on + timedelta(days=package.validity_days - 1))
    history(enrollment, actor, "purchased", package=package.id, renewed_from=renewed_from.id if renewed_from else None)
    return enrollment


def duplicate_payments(payment):
    query = Q(pk=payment.pk)
    if payment.receipt_sha256:
        query |= Q(receipt_sha256=payment.receipt_sha256)
    if payment.reference:
        query |= Q(reference=payment.reference)
    return m.Payment.objects.filter(organization_id=payment.organization_id).filter(query).exclude(pk=payment.pk).exclude(status="rejected")


def payment_preview(payment, decision, reason):
    approved = payment.enrollment.payments.filter(status="approved").aggregate(total=Sum("amount"))["total"] or Decimal("0")
    if payment.status != "pending":
        raise ValidationError("This payment has already been reviewed.")
    if payment.enrollment.status == "closed":
        raise ValidationError("This enrollment is closed.")
    if decision == "approved" and approved + payment.amount > payment.enrollment.price:
        raise ValidationError({"amount": "Payment exceeds the remaining enrollment price."})
    return {"payment": str(payment.id), "decision": decision, "reason": reason, "amount": str(payment.amount), "currency": payment.currency, "enrollment": str(payment.enrollment_id), "receipt_sha256": payment.receipt_sha256, "reference": payment.reference, "previously_approved": str(approved), "activation_effect": decision == "approved" and approved + payment.amount >= payment.enrollment.price and payment.enrollment.status == "pending", "duplicate_ids": list(map(str, duplicate_payments(payment).values_list("id", flat=True)))}


def activate_enrollment(enrollment, actor):
    if enrollment.status == "active":
        return
    if enrollment.status != "pending":
        raise ValidationError("Only pending enrollments can be activated.")
    enrollment.status = "active"
    enrollment.save()
    m.BalanceEntry.objects.get_or_create(organization_id=enrollment.organization_id, key=f"activation:{enrollment.id}", defaults={"enrollment": enrollment, "delta": enrollment.lesson_count, "reason": "Enrollment activated", "actor": actor})
    history(enrollment, actor, "activated")
    from .messaging import queue_event
    if enrollment.renewed_from_id:
        queue_event(enrollment.student, "renewal", f"renewal:{enrollment.id}")


def review_payment(payment, decision, reason, actor, acknowledge_duplicates=False):
    preview = payment_preview(payment, decision, reason)
    if decision == "approved" and preview["duplicate_ids"] and not acknowledge_duplicates:
        raise ValidationError({"acknowledge_duplicates": "Review the possible duplicate receipts or references."})
    payment.status = decision
    payment.review_reason = reason
    payment.reviewed_by = actor
    payment.reviewed_at = timezone.now()
    payment.save()
    if preview["activation_effect"]:
        activate_enrollment(payment.enrollment, actor)
    history(payment, actor, decision, reason, duplicates=preview["duplicate_ids"])
    return payment


def rate_for(session):
    day = session.starts_at.astimezone(ZoneInfo(session.teacher.timezone)).date()
    rate = session.teacher.rates.filter(effective_from__lte=day).order_by("-effective_from").first()
    if not rate:
        raise ValidationError({"teacher_rate": "No effective teacher rate exists for this session."})
    minutes = session.actual_minutes or int((session.ends_at - session.starts_at).total_seconds() // 60)
    amount = rate.amount if rate.basis == "session" else rate.amount * Decimal(minutes) / Decimal(60)
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), rate.currency


def financial_preview(session, deduct_student, pay_teacher):
    current_delta = m.BalanceEntry.objects.filter(session=session).aggregate(total=Sum("delta"))["total"] or Decimal("0")
    target_delta = Decimal("-1") if deduct_student else Decimal("0")
    delta = target_delta - current_delta
    current_balance = balance(session.enrollment)
    earnings = m.EarningEntry.objects.filter(session=session)
    existing = list(earnings.values("teacher_id", "currency").annotate(total=Sum("amount")))
    target_amount, target_currency = rate_for(session) if pay_teacher else (Decimal("0"), "")
    return {"deduct_student": deduct_student, "pay_teacher": pay_teacher, "enrollment": str(session.enrollment_id), "current_balance": str(current_balance), "balance_change": str(delta), "resulting_balance": str(current_balance + delta), "teacher": str(session.teacher_id), "teacher_amount": str(target_amount), "teacher_currency": target_currency, "previous_earnings": [{**item, "teacher_id": str(item["teacher_id"]), "total": str(item["total"])} for item in existing], "closed_payroll_adjustment": earnings.filter(payroll__status__in=["approved", "paid"]).exists()}


def apply_financials(session, deduct_student, pay_teacher, reason, actor):
    preview = financial_preview(session, deduct_student, pay_teacher)
    delta = Decimal(preview["balance_change"])
    if Decimal(preview["resulting_balance"]) < 0:
        raise ValidationError({"balance": "Insufficient lessons. Renew or adjust the balance before approving."})
    if delta:
        m.BalanceEntry.objects.create(organization_id=session.organization_id, enrollment=session.enrollment, session=session, delta=delta, key=f"session:{session.id}:v{session.version}", reason=reason, actor=actor)
    target = {(str(session.teacher_id), preview["teacher_currency"]): Decimal(preview["teacher_amount"])} if pay_teacher else {}
    existing = {(row["teacher_id"], row["currency"]): Decimal(row["total"]) for row in preview["previous_earnings"]}
    for teacher_currency in sorted(existing.keys() | target.keys()):
        amount = target.get(teacher_currency, Decimal("0")) - existing.get(teacher_currency, Decimal("0"))
        if not amount:
            continue
        teacher_id, currency = teacher_currency
        original = m.EarningEntry.objects.filter(session=session, teacher_id=teacher_id, currency=currency).order_by("created_at").first()
        earned_on = session.starts_at.astimezone(ZoneInfo(settings_for(session.organization).timezone)).date()
        # Corrections are new entries. Approved/paid statements remain unchanged.
        if preview["closed_payroll_adjustment"]:
            earned_on = timezone.localdate()
        m.EarningEntry.objects.create(organization_id=session.organization_id, teacher_id=teacher_id, session=session, amount=amount, currency=currency, earned_on=earned_on, adjustment_of=original, reason=reason, actor=actor, key=f"session:{session.id}:v{session.version}:{teacher_id}:{currency}")
    if delta < 0 and Decimal(preview["resulting_balance"]) <= settings_for(session.organization).low_balance_threshold:
        from .messaging import queue_event
        queue_event(session.student, "low_balance", f"low:{session.id}:v{session.version}")
    return preview


def balance_preview(enrollment, delta, reason):
    if enrollment.status != "active":
        raise ValidationError("Only active enrollments can be adjusted.")
    current = balance(enrollment)
    if current + delta < 0:
        raise ValidationError({"delta": "The resulting balance cannot be negative."})
    return {"enrollment": str(enrollment.id), "current_balance": str(current), "adjustment": str(delta), "resulting_balance": str(current + delta), "reason": reason}


def payroll_entries(payroll):
    if payroll.status in {"approved", "paid"}:
        return payroll.entries.all()
    next_month = (payroll.month.replace(day=28) + timedelta(days=4)).replace(day=1)
    # Carry unclosed prior-month earnings and later corrections into this payroll.
    return m.EarningEntry.objects.filter(organization_id=payroll.organization_id, payroll__isnull=True, earned_on__lt=next_month)


def payroll_preview(payroll, target):
    allowed = {"draft": "reviewed", "reviewed": "approved", "approved": "paid"}
    if allowed.get(payroll.status) != target:
        raise ValidationError({"status": "Payroll must progress Draft → Reviewed → Approved → Paid."})
    entries = payroll_entries(payroll)
    next_month = (payroll.month.replace(day=28) + timedelta(days=4)).replace(day=1)
    zone = ZoneInfo(settings_for(payroll.organization).timezone)
    from datetime import datetime, time
    cutoff = datetime.combine(next_month, time(), zone)
    exceptions = list(m.Session.objects.filter(organization_id=payroll.organization_id, starts_at__lt=cutoff, ends_at__lte=timezone.now(), status__in=["scheduled", "needs_review"]).values_list("id", flat=True))
    issues = list(m.EarningsIssue.objects.filter(organization_id=payroll.organization_id, status="open").values_list("id", flat=True))
    return {"payroll": str(payroll.id), "month": str(payroll.month), "from_status": payroll.status, "to_status": target, "entry_ids": list(map(str, entries.order_by("id").values_list("id", flat=True))), "totals": [{"currency": r["currency"], "total": str(r["total"])} for r in monetary_totals(entries)], "pending_session_ids": list(map(str, exceptions)), "open_issue_ids": list(map(str, issues)), "finality": "Approved entries are immutable. Corrections become new adjustments."}


def transition_payroll(payroll, target, actor, payment_reference=""):
    preview = payroll_preview(payroll, target)
    if target in {"reviewed", "approved"} and (preview["pending_session_ids"] or preview["open_issue_ids"]):
        raise ValidationError("Resolve pending session reports and earnings issues before closing payroll.")
    if target == "approved":
        payroll_entries(payroll).update(payroll=payroll)
        payroll.approved_by = actor
        payroll.approved_at = timezone.now()
    if target == "paid":
        if not payment_reference:
            raise ValidationError({"payment_reference": "A payment reference is required."})
        payroll.paid_at = timezone.now()
        payroll.payment_reference = payment_reference
    payroll.status = target
    payroll.save()
    history(payroll, actor, target, totals=preview["totals"])
    return payroll
