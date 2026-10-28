import asyncio
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db.models import F, Q
from django.utils import timezone

from .models import AgentRun, BrowserProfile
from .services import execute_run, purge_run_files


@shared_task(
    name='product.browser_agent.tasks.run_agent',
    queue='browser',
    autoretry_for=(),       # a run whose worker died is resumed by reap_stale_runs, from its checkpoint
    max_retries=0,
    soft_time_limit=settings.AGENT_RUN_TIMEOUT + 60,
    time_limit=settings.AGENT_RUN_TIMEOUT + 120,
)
def run_agent(run_id: str) -> None:
    asyncio.run(execute_run(run_id))


@shared_task(name='product.browser_agent.tasks.reap_stale_runs', queue='maintenance')
def reap_stale_runs() -> int:
    """Resume runs whose worker died (their heartbeat stopped) from their last finished step,
    or fail them after AGENT_MAX_RECOVERIES resumes; free their profiles; purge old run files."""
    now = timezone.now()
    silent = now - timedelta(seconds=settings.AGENT_STALE_AFTER_S)
    # Runs started before heartbeats existed only have started_at to go by.
    legacy = now - timedelta(seconds=settings.AGENT_RUN_TIMEOUT + 300)
    stale = AgentRun.objects.filter(status=AgentRun.Status.RUNNING).filter(
        Q(heartbeat_at__lt=silent) | Q(heartbeat_at=None, started_at__lt=legacy))
    count = 0
    for run in stale:
        running = AgentRun.objects.filter(pk=run.pk, status=AgentRun.Status.RUNNING)
        if run.recoveries < settings.AGENT_MAX_RECOVERIES:
            reaped = running.update(status=AgentRun.Status.QUEUED, recoveries=F('recoveries') + 1,
                                    heartbeat_at=None, updated_at=now)
            if reaped:
                run_agent.delay_on_commit(str(run.id))
        else:
            reaped = running.update(status=AgentRun.Status.FAILED, finished_at=now, updated_at=now,
                                    error=f'Worker stopped {run.recoveries + 1} times before the run finished.')
        if reaped and run.profile_id:
            BrowserProfile.objects.filter(pk=run.profile_id).update(in_use=False)
        count += reaped

    expired = AgentRun.objects.filter(
        finished_at__lt=timezone.now() - timedelta(days=settings.AGENT_ARTIFACT_RETENTION_DAYS))
    for run in expired:
        purge_run_files(run)
        run.artifacts.all().delete()
    return count
