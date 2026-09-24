from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
    Announcement,
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


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display  = ('campaign_id', 'title', 'is_active', 'updated_at')
    list_filter   = ('is_active',)
    search_fields = ('campaign_id', 'title', 'alt_text')
    readonly_fields = ('created_at', 'updated_at')

    def save_model(self, request, obj, form, change):
        """Enforce single-active rule from Django admin too."""
        super().save_model(request, obj, form, change)
        if obj.is_active:
            from .models import Announcement as Ann
            Ann.objects.exclude(pk=obj.pk).update(is_active=False)


# ── EmailConfiguration ────────────────────────────────────────────────────────

from django import forms
from django.contrib import messages
from django.core.exceptions import ValidationError
from django.utils.html import format_html

from .models import EmailConfiguration


class EmailConfigurationForm(forms.ModelForm):
    """
    Custom admin form for EmailConfiguration.

    Password handling
    ─────────────────
    - The password field is rendered as a masked PasswordInput.
    - Leaving it blank (or submitting the placeholder) preserves the existing value.
    - Only submitting an actual new value replaces the stored password.
    - The stored password is NEVER sent to the browser.

    Validation
    ──────────
    - SMTP backend requires a non-empty host.
    - use_tls and use_ssl are mutually exclusive for SMTP.
    """

    _PLACEHOLDER = EmailConfiguration._SECRET_PLACEHOLDER

    # Override password field to use PasswordInput and hide stored value
    password = forms.CharField(
        label='SMTP password',
        required=False,
        widget=forms.PasswordInput(render_value=False),
        help_text=(
            'Leave blank to keep the current password. '
            'Enter a new value to replace it. '
            'The stored password is never shown here.'
        ),
    )

    class Meta:
        model = EmailConfiguration
        fields = '__all__'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # If an existing password is set, show a placeholder so the admin
        # knows a credential is already stored without revealing its value.
        if self.instance and self.instance.pk and self.instance.password:
            self.fields['password'].widget.attrs['placeholder'] = self._PLACEHOLDER

        # Make SMTP-specific fields not required at the form level —
        # clean() enforces them conditionally.
        for field_name in ('host', 'port', 'use_tls', 'use_ssl', 'username'):
            if field_name in self.fields:
                self.fields[field_name].required = False

    def clean(self):
        cleaned = super().clean()
        backend = cleaned.get('backend', '')
        smtp    = EmailConfiguration.Backend.SMTP

        if backend == smtp:
            host = (cleaned.get('host') or '').strip()
            if not host:
                self.add_error('host', 'A hostname is required for the SMTP backend.')

            use_tls = cleaned.get('use_tls', False)
            use_ssl = cleaned.get('use_ssl', False)
            if use_tls and use_ssl:
                self.add_error(
                    'use_ssl',
                    'use_tls and use_ssl are mutually exclusive. Enable only one.',
                )

        return cleaned

    def save(self, commit=True):
        instance = super().save(commit=False)
        submitted_password = self.cleaned_data.get('password', '')
        # Only update the stored password if the admin supplied a real new value
        if submitted_password:
            instance.password = submitted_password
        # else: leave instance.password unchanged (it was not sent to the browser)
        if commit:
            instance.save()
        return instance


@admin.register(EmailConfiguration)
class EmailConfigurationAdmin(admin.ModelAdmin):
    form = EmailConfigurationForm

    list_display = (
        'backend_display', 'host', 'port', 'is_active',
        'from_email', 'verification_enabled', 'updated_at',
    )
    list_filter  = ('is_active', 'backend', 'verification_enabled')

    readonly_fields = ('created_at', 'updated_at', 'current_mailer_preview')

    fieldsets = (
        ('Status', {
            'fields': ('is_active',),
        }),
        ('Email backend', {
            'fields': ('backend',),
            'description': (
                'Choose <strong>SMTP</strong> for production. '
                'Use <strong>Console</strong> for development — emails are printed to the '
                'terminal and the SMTP fields below are ignored.'
            ),
        }),
        ('SMTP transport (SMTP backend only)', {
            'fields': ('host', 'port', 'use_tls', 'use_ssl', 'username', 'password', 'timeout'),
            'description': 'These fields are ignored for non-SMTP backends.',
        }),
        ('Sender identity', {
            'fields': ('from_email', 'reply_to'),
        }),
        ('Email verification', {
            'fields': ('verification_enabled', 'verification_token_expiry_hours'),
        }),
        ('Diagnostics', {
            'fields': ('current_mailer_preview', 'created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )

    actions = ['send_test_email_action']

    # ── Custom list columns ───────────────────────────────────────────────

    @admin.display(description='Backend')
    def backend_display(self, obj):
        return obj.get_backend_display()

    # ── Diagnostic readonly field ─────────────────────────────────────────

    @admin.display(description='Effective MAILERS["default"] preview')
    def current_mailer_preview(self, obj):
        """Show what MAILERS["default"] looks like for this config (no secrets)."""
        d = obj.to_mailer_dict()
        # Mask password in the preview
        opts = dict(d.get('OPTIONS', {}))
        if 'password' in opts:
            opts['password'] = EmailConfiguration._SECRET_PLACEHOLDER
        safe_d = {'BACKEND': d['BACKEND'], 'OPTIONS': opts}
        import json
        return format_html('<pre style="margin:0;font-size:.85em">{}</pre>',
                           json.dumps(safe_d, indent=2))

    # ── Send test email action ────────────────────────────────────────────

    @admin.action(description='📧 Send test email using this configuration')
    def send_test_email_action(self, request, queryset):
        """
        Send a test email through the selected configuration.

        Security:
        - Only superusers can trigger this action.
        - The recipient is the requesting admin's own email address — the
          action cannot be used as an arbitrary email relay.
        - SMTP credentials are never logged or shown in the response.
        """
        if not request.user.is_superuser:
            self.message_user(
                request,
                'Only superusers may send test emails.',
                level=messages.ERROR,
            )
            return

        if queryset.count() != 1:
            self.message_user(
                request,
                'Select exactly one configuration to test.',
                level=messages.WARNING,
            )
            return

        cfg = queryset.first()

        # Test recipient = requesting admin's own email (prevents relay abuse)
        recipient = request.user.email
        if not recipient:
            self.message_user(
                request,
                'Your admin account has no email address. Add one to your user profile first.',
                level=messages.ERROR,
            )
            return

        self._do_send_test(request, cfg, recipient)

    def _do_send_test(self, request, cfg, recipient):
        """Perform the test send. Errors are sanitised before display."""
        import logging as _logging
        _logger = _logging.getLogger(__name__)

        # Temporarily apply this configuration for the test send
        from django.conf import settings as _settings
        # Save original and temporarily apply test config.
        # Django 6.1: only MAILERS is modified — never EMAIL_* settings.
        _orig_mailers = dict(_settings.MAILERS)
        _settings.MAILERS['default'] = cfg.to_mailer_dict()

        try:
            from django.core.mail import send_mail as _send_mail
            _send_mail(
                subject='[IIC IT Helpdesk] Email Configuration Test',
                message=(
                    'This is a test email from the IIC IT Helpdesk.\n\n'
                    'The configured email transport is working correctly.\n\n'
                    'Sent from Django Admin.'
                ),
                from_email=cfg.from_email or 'noreply@iic.edu.np',
                recipient_list=[recipient],
                html_message=(
                    '<p>This is a test email from the <strong>IIC IT Helpdesk</strong>.</p>'
                    '<p>The configured email transport is working correctly.</p>'
                    '<p><em>Sent from Django Admin.</em></p>'
                ),
            )
            self.message_user(
                request,
                f'✅ Test email sent successfully to {recipient} '
                f'using {cfg.get_backend_display()}.',
                level=messages.SUCCESS,
            )
            _logger.info(
                'Admin test email sent to %s using backend=%s by %s',
                recipient,
                cfg.backend,
                request.user.username,
            )
        except Exception as exc:
            # Show a useful but sanitised error — never show credentials
            exc_type = type(exc).__name__
            self.message_user(
                request,
                f'❌ Test email failed ({exc_type}). '
                f'Check the SMTP settings and server logs for details.',
                level=messages.ERROR,
            )
            _logger.error(
                'Admin test email failed for user %s, backend=%s: %s',
                request.user.username,
                cfg.backend,
                exc_type,
                # Deliberately NOT logging exc.args — may contain SMTP auth details
            )
        finally:
            # Restore original MAILERS (Django 6.1 — no EMAIL_* to restore)
            _settings.MAILERS = _orig_mailers

    # ── Singleton: hide "Add another" when one row already exists ─────────

    def has_add_permission(self, request):
        return not EmailConfiguration.objects.exists()
