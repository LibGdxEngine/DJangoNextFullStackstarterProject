import os
from celery import Celery

# Set default settings module
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings.dev')

# Resolved lazily, so every @shared_task inherits the retry/ack/dead-letter policy.
app = Celery('core', task_cls='apps.common.tasks.base:BaseTask')

# Read config from django settings using CELERY namespace
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django app configs.
app.autodiscover_tasks()
