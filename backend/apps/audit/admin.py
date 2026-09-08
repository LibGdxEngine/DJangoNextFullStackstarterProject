from django.contrib import admin
from .models import AuditLog

@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'actor', 'resource_type', 'resource_id', 'ip_address', 'created_at')
    list_filter = ('action', 'resource_type', 'created_at')
    search_fields = ('action', 'resource_type', 'resource_id', 'actor__username')
    readonly_fields = [f.name for f in AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
