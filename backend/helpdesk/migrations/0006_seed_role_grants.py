# Hand-written data migration — do NOT regenerate with makemigrations.
#
# Populates initial RoleGrant records for every existing User, seeds
# InternCategoryScope with the three default slugs, and seeds
# DomainRoleMapping from settings.ALLOWED_REGISTRATION_DOMAINS.
#
# Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
# Design: Migration Strategy → Migration 2

from django.conf import settings
from django.db import migrations
from django.utils import timezone


# ---------------------------------------------------------------------------
# Default intern-scope slugs (matches design doc and Requirement 4.1)
# ---------------------------------------------------------------------------
DEFAULT_INTERN_SCOPE_SLUGS = [
    'device-support',
    'wifi-issue',
    'general-support',
]


def seed_role_grants(apps, schema_editor):
    """
    Forward migration function.

    Step 1  — superusers          → 'administrator' grant
    Step 2  — staff (not super)   → 'faculty_staff' grant
    Step 3  — plain users         → 'student' grant
    Step 4  — seed InternCategoryScope (if table is empty)
    Step 5  — seed DomainRoleMapping  (if table is empty)

    Users who already have *any* RoleGrant are skipped for steps 2 & 3.
    Superusers who already have an 'administrator' grant are skipped for step 1.
    A UserProfile is created for every user that does not already have one.
    """
    User = apps.get_model('auth', 'User')
    RoleGrant = apps.get_model('helpdesk', 'RoleGrant')
    UserProfile = apps.get_model('helpdesk', 'UserProfile')
    InternCategoryScope = apps.get_model('helpdesk', 'InternCategoryScope')
    DomainRoleMapping = apps.get_model('helpdesk', 'DomainRoleMapping')

    now = timezone.now()

    # Helper: ensure UserProfile exists for a user
    def ensure_profile(user):
        if not UserProfile.objects.filter(user=user).exists():
            UserProfile.objects.create(user=user)

    # -----------------------------------------------------------------------
    # Step 1 — superusers → 'administrator'
    # -----------------------------------------------------------------------
    for user in User.objects.filter(is_superuser=True):
        ensure_profile(user)
        already_has_admin = RoleGrant.objects.filter(
            user=user, role='administrator'
        ).exists()
        if not already_has_admin:
            RoleGrant.objects.create(
                user=user,
                role='administrator',
                granted_by=None,
                granted_at=now,
                expires_at=None,
            )

    # -----------------------------------------------------------------------
    # Step 2 — staff (not superuser) → 'faculty_staff'
    # -----------------------------------------------------------------------
    for user in User.objects.filter(is_staff=True, is_superuser=False):
        ensure_profile(user)
        already_has_grant = RoleGrant.objects.filter(user=user).exists()
        if not already_has_grant:
            RoleGrant.objects.create(
                user=user,
                role='faculty_staff',
                granted_by=None,
                granted_at=now,
                expires_at=None,
            )

    # -----------------------------------------------------------------------
    # Step 3 — regular users → 'student'
    # -----------------------------------------------------------------------
    for user in User.objects.filter(is_staff=False, is_superuser=False):
        ensure_profile(user)
        already_has_grant = RoleGrant.objects.filter(user=user).exists()
        if not already_has_grant:
            RoleGrant.objects.create(
                user=user,
                role='student',
                granted_by=None,
                granted_at=now,
                expires_at=None,
            )

    # -----------------------------------------------------------------------
    # Step 4 — seed InternCategoryScope if the table is empty
    # -----------------------------------------------------------------------
    if not InternCategoryScope.objects.exists():
        for slug in DEFAULT_INTERN_SCOPE_SLUGS:
            InternCategoryScope.objects.create(
                slug=slug,
                description='',
                is_active=True,
            )

    # -----------------------------------------------------------------------
    # Step 5 — seed DomainRoleMapping if the table is empty
    # -----------------------------------------------------------------------
    allowed_domains = getattr(settings, 'ALLOWED_REGISTRATION_DOMAINS', ())
    if allowed_domains and not DomainRoleMapping.objects.exists():
        for domain in allowed_domains:
            domain = domain.strip().lower()
            if domain:
                DomainRoleMapping.objects.create(
                    domain=domain,
                    role='student',
                )


def reverse_seed_role_grants(apps, schema_editor):
    """
    Reverse migration function.

    Removes all auto-created grants (granted_by=None), all InternCategoryScope
    records, and all DomainRoleMapping records seeded by this migration.
    """
    RoleGrant = apps.get_model('helpdesk', 'RoleGrant')
    InternCategoryScope = apps.get_model('helpdesk', 'InternCategoryScope')
    DomainRoleMapping = apps.get_model('helpdesk', 'DomainRoleMapping')

    # Delete all system-created (auto-seeded) role grants.
    # System grants are identified by granted_by=None (no human actor).
    RoleGrant.objects.filter(granted_by__isnull=True).delete()

    # Delete all InternCategoryScope records seeded by this migration.
    InternCategoryScope.objects.all().delete()

    # Delete all DomainRoleMapping records seeded by this migration.
    DomainRoleMapping.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('helpdesk', '0005_role_system'),
    ]

    operations = [
        migrations.RunPython(
            seed_role_grants,
            reverse_seed_role_grants,
            atomic=True,
        ),
    ]
