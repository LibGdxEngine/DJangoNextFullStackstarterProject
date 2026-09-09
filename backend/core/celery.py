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

# Register before tasks execute. Prefork parents stay uninitialized so replacement
# children never inherit SDK providers or exporter threads.
from celery import signals
from core import telemetry

signals.worker_process_init.connect(lambda **kwargs: telemetry.initialize(), weak=False)


@signals.worker_ready.connect
def initialize_nonfork_worker(sender=None, **kwargs):
    # A prefork parent must remain uninitialized even after startup: replacement
    # children fork from it later when a worker crashes or max-tasks is reached.
    if sender and not getattr(sender.pool, 'is_green', False):
        if sender.pool.__class__.__module__ in {'celery.concurrency.solo', 'celery.concurrency.thread'}:
            telemetry.initialize()


signals.beat_init.connect(lambda **kwargs: telemetry.initialize(), weak=False)
signals.worker_process_shutdown.connect(telemetry.shutdown, weak=False)
signals.worker_shutdown.connect(telemetry.shutdown, weak=False)
signals.before_task_publish.connect(telemetry.publish_context, weak=False)
signals.task_prerun.connect(telemetry.task_started, weak=False)
signals.task_postrun.connect(telemetry.task_finished, weak=False)
signals.task_retry.connect(telemetry.task_retried, weak=False)


@signals.setup_logging.connect
def configure_task_logging(**kwargs):
    from logging.config import dictConfig
    from django.conf import settings
    dictConfig(settings.LOGGING)
