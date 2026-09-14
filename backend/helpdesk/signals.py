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


# ---------------------------------------------------------------------------
# Notification triggers — ticket lifecycle events
# ---------------------------------------------------------------------------

from django.conf import settings as django_settings
from django.db.models.signals import pre_save


def get_helpdesk_url() -> str:
    """Return the configured helpdesk URL, falling back to localhost."""
    return getattr(django_settings, 'HELPDESK_URL', 'http://localhost:3000')


def _ticket_context(ticket, extra: dict | None = None) -> dict:
    """Build the base notification context for a ticket."""
    requester = ticket.requester
    requester_name = requester.get_full_name() or requester.username
    requester_email = requester.email or ''

    ctx = {
        'ticket_reference': ticket.reference,
        'ticket_subject': ticket.subject,
        'requester_name': requester_name,
        'requester_email': requester_email,
        'to_email': requester_email,
        'category_name': ticket.category.name if ticket.category_id else '',
        'helpdesk_url': get_helpdesk_url(),
        'resolution_note': ticket.status_reason or '',
    }
    if extra:
        ctx.update(extra)
    return ctx


@receiver(pre_save, sender='helpdesk.Ticket')
def capture_ticket_old_values(sender, instance, **kwargs):
    """
    Pre-save receiver for Ticket.
    Captures old status and old assigned_to before the update
    so post_save can detect changes.
    """
    if instance.pk:
        try:
            from helpdesk.models import Ticket  # noqa: PLC0415
            old = Ticket.objects.get(pk=instance.pk)
            instance._old_status = old.status
            instance._old_assigned_to = old.assigned_to_id
        except Exception:
            instance._old_status = None
            instance._old_assigned_to = None
    else:
        instance._old_status = None
        instance._old_assigned_to = None


@receiver(post_save, sender='helpdesk.Ticket')
def ticket_notification_dispatch(sender, instance, created, **kwargs):
    """
    Post-save receiver for Ticket.
    Fires the appropriate notification events based on what changed.
    All notification sends are wrapped so they never break the save.
    """
    from helpdesk.notifications import send_event  # noqa: PLC0415

    try:
        if created:
            ctx = _ticket_context(instance)
            send_event('ticket_submitted', ctx, ticket=instance)
            return

        # ── Changed fields ────────────────────────────────────────────────
        old_status = getattr(instance, '_old_status', None)
        old_assigned_to = getattr(instance, '_old_assigned_to', None)
        new_status = instance.status
        new_assigned_to = instance.assigned_to_id

        # Resolved event
        if old_status != 'resolved' and new_status == 'resolved':
            ctx = _ticket_context(instance, {'resolution_note': instance.status_reason or ''})
            try:
                send_event('ticket_resolved', ctx, ticket=instance)
            except Exception as exc:
                logger.exception('Error sending ticket_resolved notification: %s', exc)

        # Assigned event (newly assigned from unassigned)
        if old_assigned_to is None and new_assigned_to is not None:
            assignee = instance.assigned_to
            assignee_name = assignee.get_full_name() or assignee.username if assignee else ''
            ctx = _ticket_context(instance, {'assignee_name': assignee_name})
            try:
                send_event('ticket_assigned', ctx, ticket=instance)
            except Exception as exc:
                logger.exception('Error sending ticket_assigned notification: %s', exc)

        # Status changed event (any status change)
        if old_status is not None and old_status != new_status:
            ctx = _ticket_context(instance, {
                'old_status': old_status,
                'new_status': new_status,
            })
            try:
                send_event('status_changed', ctx, ticket=instance)
            except Exception as exc:
                logger.exception('Error sending status_changed notification: %s', exc)

    except Exception as exc:
        logger.exception('Unexpected error in ticket_notification_dispatch: %s', exc)
