from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
    DomainRoleMapping,
    GuideArticle,
    InternCategoryScope,
    RoleAuditEvent,
    RoleGrant,
    ServiceCategory,
    SoftwareResource,
    Ticket,
    UserProfile,
)


# ── Inlines ──────────────────────────────────────────────────────────────────

class RoleGrantInline(admin.TabularInline):
    model = RoleGrant
    fk_name = 'user'
    extra = 0
    fields = ('role', 'granted_by', 'granted_at', 'expires_at')
    readonly_fields = ('granted_at',)
    can_delete = True


class UserProfileInline(admin.StackedInline):
    model = UserProfile
    extra = 0
    can_delete = False
    fields = ('programme', 'department')


# ── Existing registrations ────────────────────────────────────────────────────

@admin.register(ServiceCategory)
class ServiceCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'audience', 'is_active', 'sort_order')
    list_filter = ('audience', 'is_active')
    prepopulated_fields = {'slug': ('name',)}
    ordering = ('sort_order', 'name')


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ('reference', 'subject', 'category', 'status', 'priority', 'assigned_to', 'team', 'created_at')
    list_filter = ('status', 'priority', 'category', 'assigned_to')
    search_fields = ('reference', 'subject', 'requester__email', 'team')
    readonly_fields = ('reference', 'created_at', 'updated_at')


@admin.register(GuideArticle)
class GuideArticleAdmin(admin.ModelAdmin):
    list_display = ('title', 'status', 'audience', 'reviewed_at', 'updated_at')
    list_filter = ('status', 'audience')
    search_fields = ('title', 'summary')
    prepopulated_fields = {'slug': ('title',)}


@admin.register(SoftwareResource)
class SoftwareResourceAdmin(admin.ModelAdmin):
    list_display = ('name', 'version', 'status', 'audience', 'updated_at')
    list_filter = ('status', 'audience')
    search_fields = ('name', 'description', 'version')
    prepopulated_fields = {'slug': ('name',)}


# ── Task 11.1 — New model registrations ──────────────────────────────────────

# Extend the built-in UserAdmin to show RoleGrant and UserProfile inlines
# on the User change page, satisfying Requirement 8.6.
User = get_user_model()

if admin.site.is_registered(User):
    admin.site.unregister(User)


@admin.register(User)
class UserProfileAdmin(BaseUserAdmin):
    inlines = list(BaseUserAdmin.inlines or []) + [UserProfileInline, RoleGrantInline]


@admin.register(DomainRoleMapping)
class DomainRoleMappingAdmin(admin.ModelAdmin):
    list_display = ('domain', 'role', 'created_at')
    search_fields = ('domain',)
    list_filter = ('role',)


@admin.register(InternCategoryScope)
class InternCategoryScopeAdmin(admin.ModelAdmin):
    list_display = ('slug', 'description', 'is_active')
    list_filter = ('is_active',)


# ── Task 11.2 — RoleAuditEvent (read-only) ────────────────────────────────────

@admin.register(RoleAuditEvent)
class RoleAuditEventAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'actor', 'target', 'role', 'action')
    list_filter = ('action', 'role')
    search_fields = ('actor__username', 'target__username')
    readonly_fields = ('actor', 'target', 'role', 'action', 'timestamp')
    ordering = ('-timestamp',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
