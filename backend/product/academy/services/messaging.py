from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from .. import models as m
from .common import settings_for, lock_academy


def connection_for(organization):
    # Server-side tenant binding: an academy cannot choose another tenant's channel.
    return getattr(settings, "ACADEMY_WHATSAPP_CONNECTIONS", {}).get(organization.slug, "")


def queue_event(student, event, key, session=None):
    automation = m.MessageAutomation.objects.filter(organization_id=student.organization_id, event=event, is_enabled=True, template__is_active=True).select_related("template").first()
    if not automation:
        return []
    variables = {"student": student.name, "academy": student.organization.name}
    if session:
        from .scheduling import zoned_times
        variables.update({"session": str(session.id), "status": session.status, "times": zoned_times(session.starts_at, session.ends_at, student, session.teacher), "meeting_url": session.meeting_url})
    messages = []
    for contact in student.family.contacts.filter(receives_notifications=True):
        message, _ = m.Message.objects.get_or_create(organization_id=student.organization_id, key=f"{key}:{contact.id}", defaults={"family": student.family, "session": session, "template": automation.template, "destination": contact.phone, "variables": variables, "due_at": timezone.now()})
        messages.append(message)
    return messages


def queue_due_reminders():
    count = 0
    for academy in m.AcademySettings.objects.filter(organization__is_active=True):
        now = timezone.now()
        sessions = m.Session.objects.filter(organization_id=academy.organization_id, status="scheduled", starts_at__gt=now, starts_at__lte=now + timedelta(minutes=academy.reminder_minutes))
        for session_id in sessions.values_list("id", flat=True):
            with transaction.atomic():
                lock_academy(academy.organization_id)
                session = m.Session.objects.get(pk=session_id)
                if session.status == "scheduled" and session.starts_at > timezone.now():
                    count += len(queue_event(session.student, "reminder", f"reminder:{session.id}:v{session.version}", session))
    return count


def dispatch_message(message_id):
    with transaction.atomic():
        message = m.Message.objects.select_for_update().select_related("organization", "template").get(pk=message_id)
        if message.status != "queued" or message.due_at > timezone.now() or not message.organization.is_active:
            return
        connection = connection_for(message.organization)
        config = getattr(settings, "HIREAGENTS_CONNECTIONS", {}).get(connection, {})
        if not connection or not config.get("channel_id") or not config.get("api_key"):
            message.status = "action_required"
            message.error = "No WhatsApp channel is configured for this academy."
            message.save()
            m.AcademySettings.objects.filter(organization=message.organization).update(whatsapp_status="action_required")
            return
        if message.session_id and message.key.startswith("reminder:") and (message.session.status != "scheduled" or message.session.starts_at <= timezone.now()):
            message.status = "cancelled"
            message.save()
            return
        message.status = "sending"
        message.save()
    # Do not retry an uncertain provider result automatically; it may already
    # have delivered. An operator must reconcile the provider before requeueing.
    from apps.messaging.services import get_whatsapp_provider
    try:
        result = get_whatsapp_provider(connection).send_template(to=message.destination, template_name=message.template.provider_template, variables=message.variables)
    except Exception:
        m.Message.objects.filter(pk=message.pk, status="sending").update(status="action_required", error="Delivery outcome is uncertain. Reconcile with the provider before retrying.", updated_at=timezone.now())
        m.AcademySettings.objects.filter(organization=message.organization).update(whatsapp_status="action_required")
        return
    m.Message.objects.filter(pk=message.pk, status="sending").update(status="sent", provider_message_id=str(result.get("id") or result.get("message_id") or ""), sent_at=timezone.now(), updated_at=timezone.now())
    m.AcademySettings.objects.filter(organization=message.organization).update(whatsapp_status="connected")
