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
