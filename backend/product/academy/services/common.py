import hashlib
import json
from django.core import signing
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.organizations.models import Organization
from .. import models as m


def lock_academy(organization_id):
    # One lock order for schedule, balance, payment, payroll and import writes.
    # This prevents overlapping bookings and double deductions on PostgreSQL.
    return Organization.objects.select_for_update().get(pk=organization_id)


def history(obj, actor, action, reason="", **data):
    return m.HistoryEvent.objects.create(organization_id=obj.organization_id, actor=actor, entity=obj._meta.model_name, entity_id=obj.pk, action=action, reason=reason, data=json.loads(json.dumps(data, default=str)))


def balance(enrollment):
    return enrollment.ledger.aggregate(total=Sum("delta"))["total"] or 0


def preview_token(payload):
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    return signing.TimestampSigner(salt="academy.confirmation").sign(digest)


def check_preview(payload, token):
    try:
        actual = signing.TimestampSigner(salt="academy.confirmation").unsign(token, max_age=900)
    except (signing.BadSignature, TypeError):
        raise ValidationError({"preview_token": "Preview has expired. Review the action again."})
    expected = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    if actual != expected:
        raise ValidationError({"preview_token": "Records or effects changed. Review a fresh preview."})


def settings_for(organization):
    return m.AcademySettings.objects.get_or_create(organization=organization)[0]


def date_in_zone(value, zone):
    from zoneinfo import ZoneInfo
    return timezone.localtime(value, ZoneInfo(zone)).date()


def monetary_totals(entries):
    return list(entries.values("currency").annotate(total=Sum("amount")).order_by("currency"))
