"""Notification delivery tasks.

Every submodule defining a task must be imported here so ``autodiscover_tasks()`` registers it.
"""

from .dispatch import send_notification_task
from .email import send_email
from .reports import send_scheduled_reports

__all__ = [
    "send_notification_task",
    "send_email",
    "send_scheduled_reports",
]
