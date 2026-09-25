import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class RoleChoices(models.TextChoices):
    VISITOR = 'visitor', 'Visitor'
    STUDENT = 'student', 'Student'
    FACULTY_STAFF = 'faculty_staff', 'Faculty and Staff'
    IT_AGENT = 'it_agent', 'IT Agent'
    IT_NOC_INTERN = 'it_noc_intern', 'IT NOC Intern'
    SERVICE_LEAD = 'service_lead', 'Service Lead'
    DESIGNATED_APPROVER = 'designated_approver', 'Designated Approver'
    CONTENT_EDITOR = 'content_editor', 'Content Editor'
    ADMINISTRATOR = 'administrator', 'Administrator'


class ServiceCategory(models.Model):
    class Audience(models.TextChoices):
        PUBLIC = 'public', 'Public'
        STUDENT = 'student', 'Students'
        STAFF = 'staff', 'Faculty and staff'
        ALL = 'all', 'Students and staff'

    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    summary = models.CharField(max_length=240)
    audience = models.CharField(max_length=20, choices=Audience.choices, default=Audience.ALL)
    icon = models.CharField(max_length=32, default='life-buoy')
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    form_schema = models.JSONField(default=list, blank=True)
    stages = models.JSONField(
        default=list,
        blank=True,
        help_text='List of stage dicts: [{key, label, description?, icon?}]',
    )

    class Meta:
        ordering = ('sort_order', 'name')

    def __str__(self):
        return self.name


class Ticket(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = 'submitted', 'Submitted'
        TRIAGED = 'triaged', 'Triaged'
        IN_PROGRESS = 'in_progress', 'In progress'
        WAITING_REQUESTER = 'waiting_requester', 'Waiting for requester'
        WAITING_APPROVAL = 'waiting_approval', 'Waiting for approval'
        RESOLVED = 'resolved', 'Resolved'
        CLOSED = 'closed', 'Closed'
        CANCELLED = 'cancelled', 'Cancelled'

    class Priority(models.TextChoices):
        CRITICAL = 'p1', 'Critical'
        HIGH = 'p2', 'High'
        NORMAL = 'p3', 'Normal'
        LOW = 'p4', 'Low'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField(max_length=20, unique=True, editable=False)
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='tickets')
    category = models.ForeignKey(ServiceCategory, on_delete=models.PROTECT, related_name='tickets')
    subject = models.CharField(max_length=150)
    description = models.TextField(max_length=5000)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.SUBMITTED)
    priority = models.CharField(max_length=2, choices=Priority.choices, default=Priority.NORMAL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_tickets',
    )
    team = models.CharField(max_length=100, blank=True, default='')
    extra_fields = models.JSONField(default=dict, blank=True)
    status_reason = models.TextField(max_length=1000, blank=True, default='')
    current_stage = models.CharField(max_length=80, blank=True, default='')

    class Meta:
        ordering = ('-created_at',)

    def save(self, *args, **kwargs):
        if not self.reference:
            self.reference = f'IIC-{uuid.uuid4().hex[:8].upper()}'
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.reference} — {self.subject}'


class GuideArticle(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    title = models.CharField(max_length=160)
    slug = models.SlugField(unique=True)
    summary = models.CharField(max_length=300)
    pdf_file = models.FileField(upload_to='guides/%Y/%m/', blank=True)
    audience = models.CharField(max_length=20, choices=ServiceCategory.Audience.choices, default=ServiceCategory.Audience.ALL)
    tags = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    reviewed_at = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='guides_created')
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='guides_updated')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('title',)

    def __str__(self):
        return self.title


class SoftwareResource(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        ACTIVE = 'active', 'Active'
        ARCHIVED = 'archived', 'Archived'

    name = models.CharField(max_length=140)
    slug = models.SlugField(unique=True)
    description = models.CharField(max_length=400)
    version = models.CharField(max_length=80, blank=True)
    platforms = models.JSONField(default=list, blank=True)
    audience = models.CharField(max_length=20, choices=ServiceCategory.Audience.choices, default=ServiceCategory.Audience.ALL)
    licence_notes = models.CharField(max_length=500, blank=True)
    download_url = models.URLField(blank=True)
    guide = models.ForeignKey(GuideArticle, on_delete=models.SET_NULL, null=True, blank=True, related_name='software_resources')
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='software_created')
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='software_updated')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('name',)

    def __str__(self):
        return self.name


class DomainRoleMapping(models.Model):
    """Maps an email domain to a role that is automatically assigned on user creation."""

    domain = models.CharField(max_length=253, unique=True, help_text='e.g. iic.edu.np')
    role = models.CharField(max_length=20, choices=RoleChoices.choices)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('domain',)

    def __str__(self):
        return f'{self.domain} → {self.role}'


class UserProfile(models.Model):
    """One-to-one extension of auth.User storing programme and department."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profile',
    )
    programme = models.CharField(max_length=200, blank=True)
    department = models.CharField(max_length=200, blank=True)
    is_suspended     = models.BooleanField(default=False, db_index=True,
                          help_text="Marks the account as suspended. The user will see a notice at login.")
    suspension_reason = models.CharField(
        max_length=500, blank=True, default="",
        help_text="Reason shown to the user when their account is suspended.",
    )
    # Email ownership verification — set to True once the user clicks their link
    email_verified    = models.BooleanField(
        default=False, db_index=True,
        help_text="True once the user has clicked their verification link.",
    )
    email_verified_at = models.DateTimeField(
        null=True, blank=True,
        help_text="Timestamp when email was first verified.",
    )
    # Google OAuth profile picture — populated when the user signs in via Google.
    # Stored as a URL so no binary data is kept in the database.
    avatar_url = models.URLField(
        blank=True, default='',
        max_length=500,
        help_text="Google profile picture URL (empty for password-registered users).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Profile({self.user})'


class RoleGrantQuerySet(models.QuerySet):
    """Custom QuerySet for RoleGrant with helpers for active-grant filtering."""

    def active_for(self, user):
        """Return grants for *user* that have not yet expired."""
        now = timezone.now()
        return self.filter(user=user).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        )


class RoleGrant(models.Model):
    """Records a single role assignment for a user, with optional expiry."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='rolegrant_set',
    )
    role = models.CharField(max_length=20, choices=RoleChoices.choices)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='granted_roles',
    )
    granted_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    objects = RoleGrantQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'role'],
                condition=Q(expires_at__isnull=True),
                name='unique_active_rolegrant',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'role'], name='rolegrant_user_role_idx'),
            models.Index(fields=['expires_at'], name='rolegrant_expires_at_idx'),
        ]

    def __str__(self):
        expiry = f' (expires {self.expires_at})' if self.expires_at else ''
        return f'{self.user} — {self.role}{expiry}'


class RoleAuditEvent(models.Model):
    """Immutable log of every role grant and revocation."""

    ACTION_GRANTED = 'granted'
    ACTION_REVOKED = 'revoked'
    ACTION_CHOICES = [
        (ACTION_GRANTED, 'Granted'),
        (ACTION_REVOKED, 'Revoked'),
    ]

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_actions',
    )
    target = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='audit_events',
    )
    role = models.CharField(max_length=20)
    action = models.CharField(max_length=10, choices=ACTION_CHOICES)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('-timestamp',)

    def save(self, *args, **kwargs):
        if self.pk:
            raise PermissionError("RoleAuditEvent records are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("RoleAuditEvent records cannot be deleted.")

    def __str__(self):
        return f'{self.timestamp} {self.actor} → {self.target}: {self.action} {self.role}'


class InternCategoryScope(models.Model):
    """Defines which ServiceCategory slugs are accessible to IT NOC Intern users."""

    slug = models.SlugField(unique=True)
    description = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ('slug',)

    def __str__(self):
        return self.slug


class NotificationChannel(models.Model):
    class ChannelType(models.TextChoices):
        DISCORD = 'discord', 'Discord'
        GOOGLE_WORKSPACE = 'google_workspace', 'Google Workspace'
        TEAMS = 'teams', 'Microsoft Teams'
        SLACK = 'slack', 'Slack'
        EMAIL_SMTP = 'email_smtp', 'Email (SMTP)'
        EMAIL_MAILGUN = 'email_mailgun', 'Email (Mailgun)'

    type = models.CharField(max_length=20, choices=ChannelType.choices)
    name = models.CharField(max_length=200, unique=True)
    is_active = models.BooleanField(default=True)
    config = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('name',)

    def __str__(self):
        return f'{self.name} ({self.type})'


class EmailTemplate(models.Model):
    class EventType(models.TextChoices):
        TICKET_SUBMITTED = 'ticket_submitted', 'Ticket Submitted'
        TICKET_RESOLVED = 'ticket_resolved', 'Ticket Resolved'
        TICKET_ASSIGNED = 'ticket_assigned', 'Ticket Assigned'
        STATUS_CHANGED = 'status_changed', 'Status Changed'
        ACCOUNT_RECOVERY = 'account_recovery', 'Account Recovery — Send Credentials'
        RECOVERY_UNABLE_TO_VERIFY = 'recovery_unable_to_verify', 'Account Recovery — Unable to Verify'

    event_type = models.CharField(max_length=30, choices=EventType.choices)
    name = models.CharField(max_length=200)
    subject_template = models.CharField(max_length=500)
    body_html_template = models.TextField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('event_type', 'name')

    def __str__(self):
        return f'{self.name} ({self.event_type})'


class NotificationLog(models.Model):
    class Status(models.TextChoices):
        SENT = 'sent', 'Sent'
        FAILED = 'failed', 'Failed'

    channel = models.ForeignKey(
        NotificationChannel, on_delete=models.SET_NULL,
        null=True, related_name='logs'
    )
    event_type = models.CharField(max_length=30)
    ticket = models.ForeignKey(
        'Ticket', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='notification_logs'
    )
    status = models.CharField(max_length=10, choices=Status.choices)
    error_message = models.TextField(blank=True, default='')
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('-sent_at',)

    def __str__(self):
        return f'{self.event_type} via {self.channel} — {self.status}'


class NotificationRule(models.Model):
    """
    Controls which channels receive which events and who the recipients are.
    One rule = one (event_type, channel) pair.
    """

    class RecipientType(models.TextChoices):
        REQUESTER = 'requester', 'Ticket requester'
        ASSIGNEE = 'assignee', 'Assigned staff member'
        ALL_STAFF = 'all_staff', 'All active staff via email'
        CUSTOM = 'custom', 'Custom email list'

    event_type = models.CharField(
        max_length=30,
        choices=EmailTemplate.EventType.choices,
    )
    channel = models.ForeignKey(
        NotificationChannel,
        on_delete=models.CASCADE,
        related_name='rules',
    )
    is_active = models.BooleanField(default=True)
    recipient_type = models.CharField(
        max_length=20,
        choices=RecipientType.choices,
        default=RecipientType.REQUESTER,
    )
    custom_emails = models.TextField(
        blank=True,
        default='',
        help_text='Comma-separated list of email addresses (only used when recipient_type=custom).',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('event_type', 'channel')
        ordering = ('event_type', 'channel__name')

    def __str__(self):
        return f'{self.event_type} → {self.channel.name} ({self.recipient_type})'


class TicketMessage(models.Model):
    """
    A reply or staff note on a ticket.
    staff_reply=True  → staff sent this; visible to requester
    staff_reply=False → requester sent this
    is_internal=True  → internal staff note; NOT visible to requester
    """
    ticket = models.ForeignKey(
        'Ticket', on_delete=models.CASCADE, related_name='messages'
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    body = models.TextField(max_length=5000)
    is_staff_reply = models.BooleanField(default=False)
    is_internal = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('created_at',)

    def __str__(self):
        return f'Message on {self.ticket.reference} by {self.sender}'


class TicketAttachment(models.Model):
    """
    A file (PDF or image) attached by the requester when submitting a ticket.
    Stored at tickets/<ticket_id>/<filename>.
    """
    ALLOWED_CONTENT_TYPES = {
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
    }
    MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB per file

    ticket = models.ForeignKey(
        'Ticket', on_delete=models.CASCADE, related_name='attachments'
    )
    field_key = models.CharField(max_length=64, blank=True, default='',
                                  help_text='The form-schema key this file was submitted for.')
    file = models.FileField(upload_to='ticket_attachments/%Y/%m/')
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    file_size = models.PositiveIntegerField()
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='ticket_attachments'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('created_at',)

    def __str__(self):
        return f'{self.original_name} → {self.ticket.reference}'


class AccountRecoveryToken(models.Model):
    """
    8-digit backup code generated for account recovery requests.
    Also stores a temporary password that is emailed to the requester.

    Available template context variables:
      {{backup_code}}    — the 8-digit backup code
      {{temp_password}}  — the temporary password
    """
    ticket = models.OneToOneField(
        'Ticket', on_delete=models.CASCADE, related_name='recovery_token'
    )
    backup_code = models.CharField(max_length=8)
    temp_password = models.CharField(max_length=100)
    is_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'Recovery token for {self.ticket.reference}'


class RoleConfig(models.Model):
    """
    Per-role configuration stored in the database.
    Allows administrators to:
    - toggle whether a role can be granted to new users (is_grantable)
    - customise the description shown in the UI
    """
    role = models.CharField(
        max_length=20,
        choices=RoleChoices.choices,
        unique=True,
    )
    is_grantable = models.BooleanField(
        default=True,
        help_text='If False, this role cannot be assigned to new users via the admin panel.',
    )
    can_export = models.BooleanField(
        default=False,
        help_text='If True, users with this role may download ticket export reports.',
    )
    description = models.CharField(
        max_length=300,
        blank=True,
        default='',
        help_text='Short description shown in the roles admin page.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('role',)

    def __str__(self):
        return f'RoleConfig({self.role})'


class TicketFormSettings(models.Model):
    """
    Singleton model — at most one row.  Controls which built-in fields
    are shown on the ticket submission form, whether they are required,
    and their character limits.

    Built-in fields controlled here:
        subject, description, impact (priority selector)
    """
    # Subject
    subject_visible  = models.BooleanField(default=True)
    subject_required = models.BooleanField(default=True)
    subject_min_len  = models.PositiveSmallIntegerField(default=5)
    subject_max_len  = models.PositiveSmallIntegerField(default=150)

    # Description
    description_visible  = models.BooleanField(default=True)
    description_required = models.BooleanField(default=True)
    description_min_len  = models.PositiveSmallIntegerField(default=20)
    description_max_len  = models.PositiveSmallIntegerField(default=5000)

    # Impact / priority selector
    impact_visible  = models.BooleanField(default=True)
    impact_required = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Ticket form settings'
        verbose_name_plural = 'Ticket form settings'

    def __str__(self):
        return 'Ticket form settings'

    @classmethod
    def get(cls) -> 'TicketFormSettings':
        """Return the singleton row, creating it with defaults if absent."""
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


# ---------------------------------------------------------------------------
# Announcement / welcome modal
# ---------------------------------------------------------------------------

def announcement_image_path(instance, filename):
    """Upload banner images to media/announcements/<campaign_id>/<filename>."""
    return f'announcements/{instance.campaign_id}/{filename}'


class Announcement(models.Model):
    """
    A single active announcement banner shown on the public home page.

    Only one row should have is_active=True at a time — the public endpoint
    always returns the most-recently-updated active announcement so admins
    can swap campaigns by creating a new row and activating it.
    """
    campaign_id = models.SlugField(
        max_length=80, unique=True,
        help_text='Short unique slug identifying this campaign, e.g. "orientation-2026". '
                  'Changing this causes the modal to re-show for users who already dismissed it.',
    )
    title = models.CharField(max_length=160, blank=True, default='',
                             help_text='Internal label — not shown publicly.')
    image = models.ImageField(
        upload_to=announcement_image_path,
        help_text='Banner/flyer image (JPEG, PNG, WebP). Recommended: 800 × 600 px.',
    )
    alt_text = models.CharField(
        max_length=300,
        help_text='Descriptive alt text for screen readers.',
    )
    link_url = models.URLField(
        blank=True, default='',
        help_text='Optional URL the banner links to (leave blank for image-only).',
    )
    is_active = models.BooleanField(
        default=False,
        help_text='Only active announcements are served to the public home page.',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('-updated_at',)
        verbose_name = 'Announcement'
        verbose_name_plural = 'Announcements'

    def __str__(self):
        active_label = ' [ACTIVE]' if self.is_active else ''
        return f'{self.title or self.campaign_id}{active_label}'


# ---------------------------------------------------------------------------
# Rate limiting — admin-configurable rules and violation log
# ---------------------------------------------------------------------------

class RateLimitRule(models.Model):
    """
    A named rate-limit rule stored in the database.

    Each rule covers one *scope* (a short identifier that maps to one or more
    endpoint groups) and defines:
      - how many requests are allowed per window
      - what happens when the limit is exceeded (violation_action)

    Scopes understood by the system
    ────────────────────────────────
    auth_login            POST /api/v1/auth/login/
    auth_register         POST /api/v1/auth/register/
    auth_google           POST /api/v1/auth/google/
    ticket_create         POST /api/v1/tickets/
    ticket_message        POST /api/v1/tickets/{pk}/messages/
    ticket_status         POST /api/v1/tickets/{pk}/status/
    public_api            GET  any public read endpoint (services, guides, software)
    admin_user_write      POST/PATCH/DELETE /api/v1/admin/users/*
    admin_bulk            any admin write that is not user-management
    export                GET  /api/v1/admin/tickets/export/
    password_reset        future hook for password-reset endpoints
    """

    class Window(models.TextChoices):
        SECOND  = 'second',  'Per second'
        MINUTE  = 'minute',  'Per minute'
        HOUR    = 'hour',    'Per hour'
        DAY     = 'day',     'Per day'

    class ViolationAction(models.TextChoices):
        BLOCK    = 'block',   'Block the request (429)'
        WARN     = 'warn',    'Allow but log the violation'
        SUSPEND  = 'suspend', 'Suspend the account automatically'

    scope = models.CharField(
        max_length=60,
        unique=True,
        help_text='Short scope key that the throttle class looks up.',
    )
    label = models.CharField(
        max_length=160,
        blank=True,
        help_text='Human-readable label shown in the admin UI.',
    )
    description = models.TextField(
        blank=True,
        help_text='Explains what this rule protects.',
    )
    limit = models.PositiveIntegerField(
        help_text='Maximum number of requests allowed in the window.',
    )
    window = models.CharField(
        max_length=10,
        choices=Window.choices,
        default=Window.MINUTE,
    )
    violation_action = models.CharField(
        max_length=10,
        choices=ViolationAction.choices,
        default=ViolationAction.BLOCK,
    )
    is_active = models.BooleanField(
        default=True,
        help_text='Inactive rules are ignored by the throttle engine.',
    )
    # How many excess requests trigger the violation action.
    # 0 = trigger on the very first request over the limit.
    violation_threshold = models.PositiveSmallIntegerField(
        default=0,
        help_text=(
            'Number of additional requests above the limit before the '
            'violation action fires. 0 = fire immediately on first excess request.'
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('scope',)
        verbose_name = 'Rate limit rule'
        verbose_name_plural = 'Rate limit rules'

    def __str__(self):
        return f'{self.scope}: {self.limit}/{self.window} ({self.violation_action})'


class RateLimitViolation(models.Model):
    """
    Audit record created each time a rate-limit rule is exceeded.

    *identifier* is the IP address (for unauthenticated requests) or
    "user:<pk>" for authenticated ones.
    """

    class ActionTaken(models.TextChoices):
        BLOCKED   = 'blocked',   'Request blocked (429)'
        WARNED    = 'warned',    'Allowed but logged'
        SUSPENDED = 'suspended', 'Account suspended'

    rule = models.ForeignKey(
        RateLimitRule,
        on_delete=models.CASCADE,
        related_name='violations',
    )
    identifier = models.CharField(
        max_length=100,
        db_index=True,
        help_text='IP address or "user:<pk>".',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='rate_limit_violations',
        help_text='Populated when the request is authenticated.',
    )
    request_count = models.PositiveIntegerField(
        default=1,
        help_text='Total requests seen in the window when this violation was logged.',
    )
    action_taken = models.CharField(
        max_length=12,
        choices=ActionTaken.choices,
    )
    request_path = models.CharField(max_length=500, blank=True)
    request_method = models.CharField(max_length=10, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    is_resolved = models.BooleanField(
        default=False,
        help_text='Admins can mark a violation resolved after reviewing it.',
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='resolved_violations',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, help_text='Admin notes on this violation.')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('-created_at',)
        verbose_name = 'Rate limit violation'
        verbose_name_plural = 'Rate limit violations'
        indexes = [
            models.Index(fields=['identifier', 'rule'], name='rl_violation_id_rule_idx'),
            models.Index(fields=['created_at'], name='rl_violation_created_idx'),
            models.Index(fields=['is_resolved'], name='rl_violation_resolved_idx'),
        ]

    def __str__(self):
        return f'{self.rule.scope} violation by {self.identifier} at {self.created_at}'


# ---------------------------------------------------------------------------
# Email ownership verification
# ---------------------------------------------------------------------------

import hashlib
import secrets


class EmailVerificationToken(models.Model):
    """
    A single-use, time-limited token sent to a newly registered user to prove
    they control the submitted @iic.edu.np email address.

    Security properties
    ───────────────────
    - The raw token (32 random bytes → 64-char hex string) is NEVER stored in
      the database.  Only a SHA-256 hex digest of it is persisted so that a
      database compromise cannot be used to activate accounts.
    - The token is single-use: verified_at is set on first use and subsequent
      attempts against the same row are rejected.
    - The token expires after VERIFICATION_TOKEN_EXPIRY_HOURS (default 24 h).
    - Each user has at most one pending token at a time; creating a new one
      invalidates previous rows (they are deleted).
    - The token is bound to exactly one user; it cannot activate a different
      account.

    Usage
    ─────
    # Generate and store:
    raw, token = EmailVerificationToken.create_for_user(user)
    # send `raw` in the email — never store it

    # Verify:
    EmailVerificationToken.verify(raw_token_from_email)
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='verification_tokens',
    )
    token_hash = models.CharField(
        max_length=64,
        unique=True,
        help_text='SHA-256 hex digest of the raw token. Raw token is never stored.',
    )
    created_at   = models.DateTimeField(auto_now_add=True)
    expires_at   = models.DateTimeField(db_index=True)
    verified_at  = models.DateTimeField(null=True, blank=True)
    # Track attempt count to support rate-limiting at the model level
    attempt_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ('-created_at',)
        verbose_name = 'Email verification token'
        verbose_name_plural = 'Email verification tokens'
        indexes = [
            models.Index(fields=['user', 'verified_at'], name='evtoken_user_verified_idx'),
        ]

    def __str__(self):
        status_label = 'used' if self.verified_at else ('expired' if self.is_expired() else 'pending')
        return f'EmailVerificationToken({self.user}, {status_label})'

    # ── Helpers ───────────────────────────────────────────────────────────────

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def is_valid(self) -> bool:
        return self.verified_at is None and not self.is_expired()

    # ── Class-level factory ───────────────────────────────────────────────────

    @classmethod
    def _token_hash(cls, raw_token: str) -> str:
        return hashlib.sha256(raw_token.encode()).hexdigest()

    @classmethod
    def create_for_user(cls, user) -> tuple:
        """
        Generate a new verification token for *user*.

        Deletes any previous unverified tokens for this user (so there is
        always at most one pending token per account).

        Returns (raw_token: str, instance: EmailVerificationToken).
        The raw_token must be sent to the user's email and MUST NOT be stored
        or logged anywhere.
        """
        from django.conf import settings as _s
        expiry_hours = int(getattr(_s, 'VERIFICATION_TOKEN_EXPIRY_HOURS', 24))

        # Delete previous pending tokens for this user (not already verified)
        cls.objects.filter(user=user, verified_at__isnull=True).delete()

        raw_token = secrets.token_hex(32)          # 256 bits of entropy → 64 hex chars
        token_hash = cls._token_hash(raw_token)
        expires_at = timezone.now() + timezone.timedelta(hours=expiry_hours)

        instance = cls.objects.create(
            user=user,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        return raw_token, instance

    @classmethod
    def verify(cls, raw_token: str):
        """
        Validate *raw_token* and return the matching instance if valid.

        Raises ValueError with a deliberately generic message on any failure
        to avoid leaking information about token existence or expiry.
        """
        token_hash = cls._token_hash(raw_token)
        try:
            token = cls.objects.select_related('user').get(token_hash=token_hash)
        except cls.DoesNotExist:
            raise ValueError('Verification link is invalid or has already been used.')

        # Increment attempt counter and save regardless of outcome
        cls.objects.filter(pk=token.pk).update(attempt_count=models.F('attempt_count') + 1)
        token.refresh_from_db(fields=['attempt_count'])

        if token.verified_at is not None:
            raise ValueError('Verification link is invalid or has already been used.')

        if token.is_expired():
            raise ValueError('Verification link has expired. Please request a new one.')

        return token


# ---------------------------------------------------------------------------
# Admin-managed email configuration
# ---------------------------------------------------------------------------

class EmailConfiguration(models.Model):
    """
    Singleton model that allows administrators to override the .env-based
    MAILERS configuration from Django Admin.

    Precedence
    ──────────
    Active DB row → .env fallback → application defaults

    Secret handling
    ───────────────
    The SMTP password is stored as plain text in the database (matching the
    existing NotificationChannel pattern).  The admin UI masks it — the raw
    value is never returned to the browser.  Use database-level encryption or
    a secrets manager at the infrastructure layer for additional protection.

    Only one row should exist (enforced via the save() method).
    """

    class Backend(models.TextChoices):
        CONSOLE  = 'django.core.mail.backends.console.EmailBackend',  'Console (dev/testing)'
        SMTP     = 'django.core.mail.backends.smtp.EmailBackend',     'SMTP'
        DUMMY    = 'django.core.mail.backends.dummy.EmailBackend',    'Dummy (discard all)'
        FILEBASED = 'django.core.mail.backends.filebased.EmailBackend', 'File-based'
        LOCMEM   = 'django.core.mail.backends.locmem.EmailBackend',   'In-memory (testing)'

    # ── Is this configuration active? ─────────────────────────────────────
    is_active = models.BooleanField(
        default=True,
        help_text=(
            'When active, this database configuration overrides .env settings. '
            'Deactivate to fall back to .env.'
        ),
    )

    # ── Backend selection ──────────────────────────────────────────────────
    backend = models.CharField(
        max_length=100,
        choices=Backend.choices,
        default=Backend.CONSOLE,
        help_text='Email backend to use. Only SMTP requires the host/credentials below.',
    )

    # ── SMTP transport (only used when backend == SMTP) ────────────────────
    host = models.CharField(
        max_length=253, blank=True, default='localhost',
        help_text='SMTP server hostname. Required for SMTP backend.',
    )
    port = models.PositiveIntegerField(
        default=587,
        help_text='SMTP port (25 plain, 465 SSL, 587 STARTTLS).',
    )
    use_tls = models.BooleanField(
        default=True,
        help_text='Use STARTTLS. Mutually exclusive with use_ssl.',
    )
    use_ssl = models.BooleanField(
        default=False,
        help_text='Use implicit SSL/TLS. Mutually exclusive with use_tls.',
    )
    username = models.CharField(
        max_length=254, blank=True, default='',
        help_text='SMTP login username (leave blank if not required).',
    )
    # Password stored as plain text — masked in the admin form.
    # Match the existing NotificationChannel.config pattern.
    password = models.CharField(
        max_length=500, blank=True, default='',
        help_text='SMTP password / app password. Masked in the admin interface.',
    )
    timeout = models.PositiveSmallIntegerField(
        default=30,
        help_text='SMTP connection timeout in seconds.',
    )

    # ── Sender identity ────────────────────────────────────────────────────
    from_email = models.EmailField(
        default='noreply@iic.edu.np',
        help_text='The "From:" address on all outgoing emails.',
    )
    reply_to = models.EmailField(
        blank=True, default='',
        help_text='Optional "Reply-To:" address.',
    )

    # ── Verification settings (can be overridden here) ─────────────────────
    verification_enabled = models.BooleanField(
        default=True,
        help_text='Enable email verification for new registrations.',
    )
    verification_token_expiry_hours = models.PositiveSmallIntegerField(
        default=24,
        help_text='Hours before a verification link expires.',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Email configuration'
        verbose_name_plural = 'Email configuration'

    def __str__(self):
        status = 'active' if self.is_active else 'inactive'
        return f'Email configuration ({self.get_backend_display()}, {status})'

    def clean(self):
        from django.core.exceptions import ValidationError
        # Cannot enable both TLS and SSL simultaneously for SMTP
        if self.backend == self.Backend.SMTP:
            if self.use_tls and self.use_ssl:
                raise ValidationError(
                    {'use_ssl': 'use_tls and use_ssl are mutually exclusive. '
                                'Enable only one.'}
                )
            if not self.host:
                raise ValidationError(
                    {'host': 'A hostname is required for the SMTP backend.'}
                )

    def save(self, *args, **kwargs):
        # Enforce singleton — deactivate other rows when saving an active config
        if self.is_active:
            EmailConfiguration.objects.exclude(pk=self.pk).update(is_active=False)
        super().save(*args, **kwargs)

    # ── Secret masking helpers (follow notifications.py pattern) ──────────

    _SECRET_PLACEHOLDER = '••••••••'

    def password_is_set(self) -> bool:
        return bool(self.password)

    def apply_password_patch(self, submitted_password: str) -> None:
        """
        Update the password only when the admin submits a genuine new value.

        Rules:
          - Empty string  → keep existing password (blank field = no change)
          - Placeholder   → keep existing password (unchanged field = no change)
          - Any other str → replace with new value
        """
        if submitted_password and submitted_password != self._SECRET_PLACEHOLDER:
            self.password = submitted_password
        # else: keep existing password unchanged

    def to_mailer_dict(self) -> dict:
        """
        Return a Django 6.1 MAILERS-compatible dict for this configuration.
        Only SMTP backends receive transport OPTIONS; others get {}.
        """
        smtp_backend = self.Backend.SMTP
        if self.backend == smtp_backend:
            options: dict = {
                'host':    self.host,
                'port':    self.port,
                'use_tls': self.use_tls,
                'use_ssl': self.use_ssl,
                'timeout': self.timeout,
            }
            if self.username:
                options['username'] = self.username
            if self.password:
                options['password'] = self.password
        else:
            options = {}

        return {
            'BACKEND': self.backend,
            'OPTIONS': options,
        }


# ---------------------------------------------------------------------------
# Password reset token
# ---------------------------------------------------------------------------

class PasswordResetToken(models.Model):
    """
    Single-use, time-limited token for password reset.

    Security properties (mirrors EmailVerificationToken):
    - Only the SHA-256 digest is stored; the raw token is never persisted.
    - Single-use: used_at is set on first use.
    - Expires after PASSWORD_RESET_TOKEN_EXPIRY_HOURS (default 2 h).
    - At most one pending token per user; creating a new one deletes previous ones.
    - Bound to exactly one user account.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='password_reset_tokens',
    )
    token_hash = models.CharField(
        max_length=64,
        unique=True,
        help_text='SHA-256 hex digest. Raw token is never stored.',
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    expires_at  = models.DateTimeField(db_index=True)
    used_at     = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ('-created_at',)
        verbose_name = 'Password reset token'
        verbose_name_plural = 'Password reset tokens'

    def __str__(self):
        status = 'used' if self.used_at else ('expired' if self.is_expired() else 'pending')
        return f'PasswordResetToken({self.user}, {status})'

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def is_valid(self) -> bool:
        return self.used_at is None and not self.is_expired()

    @classmethod
    def _hash(cls, raw_token: str) -> str:
        return hashlib.sha256(raw_token.encode()).hexdigest()

    @classmethod
    def create_for_user(cls, user) -> tuple:
        """
        Delete any existing pending tokens, generate a new one, return (raw_token, instance).
        raw_token must be sent to the user's email and MUST NOT be stored or logged.
        """
        from django.conf import settings as _s
        expiry_hours = int(getattr(_s, 'PASSWORD_RESET_TOKEN_EXPIRY_HOURS', 2))
        cls.objects.filter(user=user, used_at__isnull=True).delete()
        raw       = secrets.token_hex(32)
        expires   = timezone.now() + timezone.timedelta(hours=expiry_hours)
        instance  = cls.objects.create(
            user=user, token_hash=cls._hash(raw), expires_at=expires
        )
        return raw, instance

    @classmethod
    def verify(cls, raw_token: str):
        """
        Look up by hash, check validity, return instance.
        Raises ValueError with a generic message on any failure.
        """
        token_hash = cls._hash(raw_token)
        try:
            token = cls.objects.select_related('user').get(token_hash=token_hash)
        except cls.DoesNotExist:
            raise ValueError('Reset link is invalid or has already been used.')
        if token.used_at is not None:
            raise ValueError('Reset link is invalid or has already been used.')
        if token.is_expired():
            raise ValueError('Reset link has expired. Please request a new one.')
        return token
