from django.contrib import admin
from .models import Organization, OrganizationMember

class OrganizationMemberInline(admin.TabularInline):
    model = OrganizationMember
    extra = 1

@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'is_active', 'created_at')
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    inlines = [OrganizationMemberInline]

@admin.register(OrganizationMember)
class OrganizationMemberAdmin(admin.ModelAdmin):
    list_display = ('organization', 'user', 'role', 'created_at')
    list_filter = ('role', 'created_at')
    search_fields = ('organization__name', 'user__username', 'user__email')
