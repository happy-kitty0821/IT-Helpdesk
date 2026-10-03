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
        profile, _ = UserProfile.objects.get_or_create(user=instance)

        # --- Step 1b: Email verification gate ---
        # Google-authenticated users carry the ``_email_verified_by_google=True``
        # marker set by GoogleLoginView before calling create_user().  For those
        # accounts Google has already proved email ownership, so we mark the
        # profile as verified and leave is_active=True.
        #
        # All other new accounts (password registration) start as INACTIVE and
        # UNVERIFIED until the user clicks the verification link.
        if getattr(instance, '_email_verified_by_google', False):
            # Google-verified — mark profile immediately
            from django.utils import timezone as _tz
            if not profile.email_verified:
                profile.email_verified    = True
                profile.email_verified_at = _tz.now()
                profile.save(update_fields=['email_verified', 'email_verified_at'])
            # is_active stays True (set by create_user default)
            _needs_email_verification = False
        else:
            # Password registration — deactivate until email is confirmed
            if instance.is_active:
                get_user_model().objects.filter(pk=instance.pk).update(is_active=False)
                instance.is_active = False  # keep in-memory state consistent
            _needs_email_verification = True

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

    # --- Step 5: Dispatch verification email (outside the savepoint) ---
    # Runs after the transaction commits so the token's FK to the user is
    # visible to the background thread.  The email dispatch itself is
    # non-blocking (daemon thread) so registration response time is unaffected.
    if _needs_email_verification:
        try:
            from helpdesk.email_verification import send_verification_email
            send_verification_email(instance)
        except Exception as exc:
            logger.error(
                'Failed to queue verification email for %s: %s',
                instance.email, exc,
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
        # Grant the user application-admin access (is_staff=True) so they can
        # access the Next.js /admin/* panel.  is_superuser is intentionally NOT
        # set here — Django backend (/admin/) access requires a separate
        # explicit promotion by an existing superuser via SetSuperuserView.
        User.objects.filter(pk=instance.user_id).update(
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
        # The flag was managed by the role system — clear both.
        User.objects.filter(pk=instance.user_id).update(
            is_superuser=False,
            is_staff=False,
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


def get_support_email() -> str:
    """
    Return the support email from SiteSettings, falling back to the .env
    VERIFICATION_FROM_EMAIL setting, then to a hardcoded default.

    SiteSettings is an admin-editable singleton so the email can be changed
    at any time without a deployment.
    """
    try:
        from helpdesk.models import SiteSettings  # local import — avoids circular
        return SiteSettings.get().support_email or 'support@iic.edu.np'
    except Exception:
        return getattr(django_settings, 'VERIFICATION_FROM_EMAIL', 'support@iic.edu.np')


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
    Captures old field values before the update so post_save receivers can
    detect changes for notifications and TicketEvent audit logging.
    """
    if instance.pk:
        try:
            from helpdesk.models import Ticket  # noqa: PLC0415
            old = Ticket.objects.get(pk=instance.pk)
            instance._old_status      = old.status
            instance._old_assigned_to = old.assigned_to_id
            instance._old_priority    = old.priority
            instance._old_stage       = old.current_stage
            instance._old_subject     = old.subject
            instance._old_team        = old.team
        except Exception:
            instance._old_status      = None
            instance._old_assigned_to = None
            instance._old_priority    = None
            instance._old_stage       = None
            instance._old_subject     = None
            instance._old_team        = None
    else:
        instance._old_status      = None
        instance._old_assigned_to = None
        instance._old_priority    = None
        instance._old_stage       = None
        instance._old_subject     = None
        instance._old_team        = None


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


# ---------------------------------------------------------------------------
# EmailConfiguration change → update live MAILERS setting
# ---------------------------------------------------------------------------

@receiver(post_save, sender='helpdesk.EmailConfiguration')
def sync_mailers_on_config_change(sender, instance, **kwargs):
    """
    When an EmailConfiguration row is saved (created or updated), immediately
    apply the new effective configuration to settings.MAILERS so that the
    next email sent uses the updated backend without a server restart.
    """
    try:
        from helpdesk.email_config_service import apply_mailers_override
        apply_mailers_override()
    except Exception as exc:
        logger.warning('sync_mailers_on_config_change failed: %s', exc)


# ---------------------------------------------------------------------------
# TicketEvent audit log — immutable record of every ticket change
# ---------------------------------------------------------------------------

@receiver(post_save, sender='helpdesk.Ticket')
def record_ticket_event(sender, instance, created, **kwargs):
    """
    Post-save receiver that appends an immutable TicketEvent row for every
    meaningful change to a Ticket.  Runs entirely in-process; never blocks
    the save on failure.

    Events recorded
    ───────────────
    - CREATED       : on first save (created=True)
    - STATUS_CHANGED: when status differs from _old_status
    - ASSIGNED      : when assigned_to changes
    - PRIORITY_CHANGED, STAGE_CHANGED, SUBJECT_CHANGED, TEAM_CHANGED are
      recorded when the corresponding captured old value differs from new.

    Old values are captured by capture_ticket_old_values (pre_save, above).
    The actor is taken from instance._event_actor when explicitly set by a
    view (e.g. TicketDetail PATCH), otherwise left null (system change).
    """
    from helpdesk.models import TicketEvent  # noqa: PLC0415

    try:
        actor = getattr(instance, '_event_actor', None)
        note  = (instance.status_reason or '').strip()[:500]

        if created:
            TicketEvent.objects.create(
                ticket    = instance,
                actor     = instance.requester,
                action    = TicketEvent.Action.CREATED,
                old_value = '',
                new_value = instance.status,
            )
            return

        # ── Detect field changes from pre_save snapshot ───────────────────

        old_status      = getattr(instance, '_old_status',      None)
        old_assigned_id = getattr(instance, '_old_assigned_to', None)
        old_priority    = getattr(instance, '_old_priority',    None)
        old_stage       = getattr(instance, '_old_stage',       None)
        old_subject     = getattr(instance, '_old_subject',     None)
        old_team        = getattr(instance, '_old_team',        None)

        events = []

        if old_status is not None and old_status != instance.status:
            events.append(TicketEvent(
                ticket    = instance,
                actor     = actor,
                action    = TicketEvent.Action.STATUS_CHANGED,
                old_value = old_status,
                new_value = instance.status,
                note      = note,
            ))

        if old_assigned_id != instance.assigned_to_id:
            assignee = instance.assigned_to
            new_val = (assignee.get_full_name() or assignee.username) if assignee else 'Unassigned'
            events.append(TicketEvent(
                ticket    = instance,
                actor     = actor,
                action    = TicketEvent.Action.ASSIGNED,
                old_value = '',
                new_value = new_val,
            ))

        if old_priority is not None and old_priority != instance.priority:
            events.append(TicketEvent(
                ticket    = instance,
                actor     = actor,
                action    = TicketEvent.Action.PRIORITY_CHANGED,
                old_value = old_priority,
                new_value = instance.priority,
            ))

        if old_stage is not None and old_stage != instance.current_stage:
            events.append(TicketEvent(
                ticket    = instance,
                actor     = actor,
                action    = TicketEvent.Action.STAGE_CHANGED,
                old_value = old_stage or '',
                new_value = instance.current_stage or '',
            ))

        if old_subject is not None and old_subject != instance.subject:
            events.append(TicketEvent(
                ticket    = instance,
                actor     = actor,
                action    = TicketEvent.Action.SUBJECT_CHANGED,
                old_value = old_subject[:200],
                new_value = instance.subject[:200],
            ))

        if old_team is not None and old_team != instance.team:
            events.append(TicketEvent(
                ticket    = instance,
                actor     = actor,
                action    = TicketEvent.Action.TEAM_CHANGED,
                old_value = old_team or '',
                new_value = instance.team or '',
            ))

        if events:
            TicketEvent.objects.bulk_create(events)

    except Exception as exc:
        logger.exception('record_ticket_event failed for ticket %s: %s', getattr(instance, 'reference', '?'), exc)
