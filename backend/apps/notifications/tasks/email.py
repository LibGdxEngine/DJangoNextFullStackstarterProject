import logging
import smtplib

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from apps.common.tasks import RETRYABLE_EXCEPTIONS, idempotent

logger = logging.getLogger(__name__)

# A refused recipient or malformed address will never succeed, so only connection-level
# SMTP faults are added to the shared retryable set.
EMAIL_RETRYABLE_EXCEPTIONS = RETRYABLE_EXCEPTIONS + (
    smtplib.SMTPConnectError,
    smtplib.SMTPServerDisconnected,
    smtplib.SMTPHeloError,
)


@shared_task(
    bind=True,
    name="apps.notifications.tasks.send_email",
    autoretry_for=EMAIL_RETRYABLE_EXCEPTIONS,
)
def send_email(self, to, subject, body, html_body=None, idempotency_key=None):
    """Send a transactional email at most once per idempotency key."""
    recipients = [to] if isinstance(to, str) else list(to)
    key = idempotency_key or self.idempotency_key(sorted(recipients), subject, body)

    with idempotent(key, task_name=self.name, task_id=self.request.id) as guard:
        if guard.is_duplicate:
            logger.info("Email for key %s was already sent; skipping", key)
            return guard.result

        email = EmailMultiAlternatives(
            subject=subject,
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=recipients,
        )
        if html_body:
            email.attach_alternative(html_body, "text/html")

        sent = email.send(fail_silently=False)
        guard.record(sent)
        return sent
