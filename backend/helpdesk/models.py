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
        ACCOUNT_RECOVERY = 'account_recovery', 'Account Recovery'

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
