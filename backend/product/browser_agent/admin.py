from django.contrib import admin

from .models import AgentArtifact, AgentRun, AgentRunEvent, BrowserProfile


class ArtifactInline(admin.TabularInline):
    model = AgentArtifact
    extra = 0
    readonly_fields = ('kind', 'path', 'size')


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = ('id', 'organization', 'status', 'created_by', 'created_at', 'finished_at')
    list_filter = ('status',)
    search_fields = ('task', 'id')
    readonly_fields = ('usage', 'final_text', 'error', 'started_at', 'finished_at')
    inlines = [ArtifactInline]


admin.site.register(BrowserProfile)
admin.site.register(AgentRunEvent)
