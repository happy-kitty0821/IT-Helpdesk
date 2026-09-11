import uuid

from django.conf import settings
from django.db import models


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
