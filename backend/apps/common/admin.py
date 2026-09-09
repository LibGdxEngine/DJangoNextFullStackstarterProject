from celery import current_app
from django.contrib import admin, messages

from .models import FailedTask, TaskExecution
from .tasks.redaction import REDACTED


def _contains_redaction(payload) -> bool:
    if payload == REDACTED:
        return True
    if isinstance(payload, dict):
        return any(_contains_redaction(value) for value in payload.values())
    if isinstance(payload, (list, tuple)):
        return any(_contains_redaction(value) for value in payload)
    return False


@admin.register(TaskExecution)
class TaskExecutionAdmin(admin.ModelAdmin):
    list_display = ('task_name', 'status', 'key', 'expires_at', 'created_at')
    list_filter = ('status', 'task_name')
    search_fields = ('key', 'task_name', 'task_id')
    readonly_fields = (
        'key', 'task_name', 'task_id', 'status', 'result', 'expires_at', 'created_at', 'updated_at',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False


@admin.register(FailedTask)
class FailedTaskAdmin(admin.ModelAdmin):
    list_display = ('task_name', 'exception_class', 'status', 'retries', 'queue', 'created_at')
    list_filter = ('status', 'task_name', 'exception_class')
    search_fields = ('task_name', 'task_id', 'exception_message')
    readonly_fields = (
        'task_name', 'task_id', 'queue', 'args', 'kwargs', 'exception_class', 'exception_message',
        'traceback', 'retries', 'requeued_task_id', 'created_at', 'updated_at',
    )
    ordering = ('-created_at',)
    actions = ('requeue_tasks', 'mark_ignored')

    def has_add_permission(self, request):
        return False

    @admin.action(description='Requeue selected tasks')
    def requeue_tasks(self, request, queryset):
        requeued = 0
        skipped = 0
        for failure in queryset.exclude(status=FailedTask.Status.REQUEUED):
            # Redacted arguments cannot be replayed: the original value is gone by design.
            if _contains_redaction(failure.args) or _contains_redaction(failure.kwargs):
                skipped += 1
                continue
            async_result = current_app.send_task(
                failure.task_name,
                args=failure.args or [],
                kwargs=failure.kwargs or {},
                queue=failure.queue or None,
            )
            failure.status = FailedTask.Status.REQUEUED
            failure.requeued_task_id = async_result.id
            failure.save(update_fields=['status', 'requeued_task_id', 'updated_at'])
            requeued += 1

        if requeued:
            self.message_user(request, f'Requeued {requeued} task(s).', messages.SUCCESS)
        if skipped:
            self.message_user(
                request,
                f'Skipped {skipped} task(s) holding redacted arguments; trigger those from the source flow.',
                messages.WARNING,
            )

    @admin.action(description='Mark selected as ignored')
    def mark_ignored(self, request, queryset):
        updated = queryset.update(status=FailedTask.Status.IGNORED)
        self.message_user(request, f'Marked {updated} task(s) as ignored.', messages.SUCCESS)
