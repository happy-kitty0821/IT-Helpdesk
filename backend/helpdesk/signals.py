"""
Signal receivers for the IIC IT Helpdesk role system.

Receivers
---------
create_profile_and_assign_role
    Fires on ``post_save`` for ``User`` (created=True only).
    Creates a ``UserProfile``, resolves the default role via
    ``DomainRoleMapping``, and creates the initial ``RoleGrant`` +
    ``RoleAuditEvent`` inside a single atomic savepoint.

sync_superuser_flag
    Fires on ``post_save`` for ``RoleGrant``.
    Keeps ``auth.User.is_superuser`` in sync whenever an
    ``administrator`` grant is created or expires.

Registration
------------
Both receivers are connected inside ``HelpdeskConfig.ready()``
(see ``helpdesk/apps.py``).
"""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Task 6.1 — create_profile_and_assign_role
# ---------------------------------------------------------------------------

@receiver(post_save, sender='auth.User')
def create_profile_and_assign_role(sender, instance, created, **kwargs):
    """
    Post-save receiver for ``auth.User``.

    Fires only when a new user is created (``created=True``).  Runs the
    entire setup inside a ``transaction.atomic()`` savepoint so that any
    failure rolls back both the profile and the grant, propagating the
    exception up to the caller (``RegisterView`` / ``GoogleLoginView``)
    which wraps its own ``transaction.atomic`` block.

    Steps
    -----
    1. Create ``UserProfile`` (idempotent — skipped if one already exists).
    2. Resolve the email domain against ``DomainRoleMapping``; fall back to
       ``'student'`` if no mapping is found.
    3. Create ``RoleGrant`` only if no active grant exists for this user yet.
    4. Create a ``RoleAuditEvent`` for the initial grant.
    """
    if not created:
        return

    # Local imports to avoid circular imports at module load time.
    from helpdesk.models import (  # noqa: PLC0415
        DomainRoleMapping,
        RoleAuditEvent,
        RoleGrant,
        UserProfile,
    )

    with transaction.atomic():
        # --- Step 1: UserProfile ---
        UserProfile.objects.get_or_create(user=instance)

        # --- Step 2: Resolve role from email domain ---
        resolved_role = 'student'
        email = instance.email or ''
        if '@' in email:
            domain = email.rsplit('@', 1)[1].strip().lower()
            mapping = DomainRoleMapping.objects.filter(domain__iexact=domain).first()
            if mapping:
                resolved_role = mapping.role

        # --- Step 3: Create RoleGrant (idempotent) ---
        active_grant_exists = RoleGrant.objects.active_for(instance).exists()
        if not active_grant_exists:
            RoleGrant.objects.create(
                user=instance,
                role=resolved_role,
                granted_by=None,
            )

        # --- Step 4: Audit event ---
        RoleAuditEvent.objects.create(
            actor=None,
            target=instance,
            role=resolved_role,
            action=RoleAuditEvent.ACTION_GRANTED,
        )


# ---------------------------------------------------------------------------
# Task 6.2 — sync_superuser_flag
# ---------------------------------------------------------------------------

@receiver(post_save, sender='helpdesk.RoleGrant')
def sync_superuser_flag(sender, instance, **kwargs):
    """
    Post-save receiver for ``helpdesk.RoleGrant``.

    Keeps ``auth.User.is_superuser`` (and ``is_staff``) consistent with
    the presence of an active ``administrator`` grant.

    Only acts when the saved grant's ``role`` is ``'administrator'``.

    Active grant
        ``expires_at`` is null, or ``expires_at`` is in the future.
        → Set ``is_superuser=True``, ``is_staff=True``.

    Inactive / expired grant
        ``expires_at`` is set and is in the past (or equal to now).
        → Check whether the user still has any *other* active
          ``administrator`` grant.

        If no other active administrator grant exists:
            Check whether ``is_superuser`` was set by the role system
            (i.e. at least one ``administrator`` grant has ever been
            recorded for this user via ``granted_by`` being null or a
            known actor).

            Because the role system always creates grants, if there are
            no remaining active grants we infer the flag was role-managed
            and set ``is_superuser=False``.

            **Exception**: if ``is_superuser`` was True on the user before
            the role system existed (detected by checking for the absence
            of any ``administrator`` RoleGrant ever recorded for this
            user), we preserve the flag and emit a warning instead.
    """
    if instance.role != 'administrator':
        return

    # Local import to avoid circular imports at module load time.
    from helpdesk.models import RoleGrant  # noqa: PLC0415

    User = get_user_model()

    now = timezone.now()
    grant_is_active = (instance.expires_at is None) or (instance.expires_at > now)

    if grant_is_active:
        # Set is_superuser and is_staff atomically (no signal loop because
        # we are updating User, not RoleGrant).
        User.objects.filter(pk=instance.user_id).update(
            is_superuser=True,
            is_staff=True,
        )
        return

    # ---- Grant is no longer active ----------------------------------------
    # Check for any other surviving active administrator grant for this user.
    other_active = (
        RoleGrant.objects
        .active_for(User.objects.get(pk=instance.user_id))
        .filter(role='administrator')
        .exclude(pk=instance.pk)
        .exists()
    )

    if other_active:
        # Another active administrator grant exists; keep flags as-is.
        return

    # No surviving active administrator grant.
    # Determine whether is_superuser was set by the role system or externally.
    user = User.objects.get(pk=instance.user_id)

    any_admin_grant_ever = (
        RoleGrant.objects
        .filter(user_id=instance.user_id, role='administrator')
        .exists()
    )

    if any_admin_grant_ever:
        # The flag was managed by the role system — clear it.
        User.objects.filter(pk=instance.user_id).update(
            is_superuser=False,
        )
    else:
        # is_superuser was set outside the role system; preserve and warn.
        if user.is_superuser:
            logger.warning(
                'sync_superuser_flag: user %s (pk=%s) has is_superuser=True '
                'but no administrator RoleGrant on record. '
                'Preserving is_superuser to avoid unintended lock-out. '
                'Remove this flag manually if it is no longer required.',
                user.get_username(),
                user.pk,
            )
