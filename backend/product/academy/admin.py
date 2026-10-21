"""Read-only support inspection. Mutations go through reviewed domain actions."""
from django.apps import apps
from django.contrib import admin


class AcademyReadOnlyAdmin(admin.ModelAdmin):
    list_display = ("id", "organization", "created_at", "updated_at")
    list_filter = ("organization",)
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


for model in apps.get_app_config("academy").get_models():
    admin.site.register(model, AcademyReadOnlyAdmin)
