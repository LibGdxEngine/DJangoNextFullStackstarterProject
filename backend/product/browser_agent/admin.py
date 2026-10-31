from django.contrib import admin

from .models import AgentArtifact, AgentRole, AgentRun, AgentRunEvent, BrowserProfile, TaskTemplate


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


@admin.register(AgentRole)
class AgentRoleAdmin(admin.ModelAdmin):
    list_display = ('name', 'title', 'organization', 'sort_order')
    search_fields = ('name', 'title', 'slug')


@admin.register(TaskTemplate)
class TaskTemplateAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'role', 'organization', 'sort_order')
    list_filter = ('category',)
    search_fields = ('title', 'prompt')


@admin.register(BrowserProfile)
class BrowserProfileAdmin(admin.ModelAdmin):
    list_display = ('name', 'organization', 'user', 'in_use', 'created_at')
    list_filter = ('in_use',)
    search_fields = ('name', 'user__email', 'organization__name')
    raw_id_fields = ('organization', 'user')


admin.site.register(AgentRunEvent)
