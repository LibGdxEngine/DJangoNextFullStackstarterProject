import asyncio
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import AgentRun, BrowserProfile
from .services import execute_run, purge_run_files


@shared_task(
    name='product.browser_agent.tasks.run_agent',
    queue='browser',
    autoretry_for=(),       # re-running a half-finished browsing session is never safe
    max_retries=0,
    soft_time_limit=settings.AGENT_RUN_TIMEOUT + 60,
    time_limit=settings.AGENT_RUN_TIMEOUT + 120,
)
def run_agent(run_id: str) -> None:
    asyncio.run(execute_run(run_id))


@shared_task(name='product.browser_agent.tasks.reap_stale_runs', queue='maintenance')
def reap_stale_runs() -> int:
    """Fail runs whose worker died, free their profiles, and purge old run files."""
    cutoff = timezone.now() - timedelta(seconds=settings.AGENT_RUN_TIMEOUT + 300)
    stale = AgentRun.objects.filter(status=AgentRun.Status.RUNNING, started_at__lt=cutoff)
    profile_ids = list(stale.exclude(profile=None).values_list('profile_id', flat=True))
    count = stale.update(status=AgentRun.Status.FAILED, error='Worker stopped before the run finished.',
                         finished_at=timezone.now())
    BrowserProfile.objects.filter(pk__in=profile_ids).update(in_use=False)

    expired = AgentRun.objects.filter(
        finished_at__lt=timezone.now() - timedelta(days=settings.AGENT_ARTIFACT_RETENTION_DAYS))
    for run in expired:
        purge_run_files(run)
        run.artifacts.all().delete()
    return count
