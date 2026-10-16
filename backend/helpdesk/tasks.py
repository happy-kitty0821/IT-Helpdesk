"""
Celery periodic tasks for the IIC IT Helpdesk.

Tasks
-----
check_stale_tickets
    Runs every 15 minutes (configured via CELERY_BEAT_SCHEDULE in settings.py).
    Finds tickets that have breached their SLA threshold without being acted on,
    sets is_overdue=True on them, and sends a ticket_stale notification.

    Escalation logic
    ~~~~~~~~~~~~~~~~
    - First threshold  → alert sent to the assignee (or service leads / admins
                         if the ticket is unassigned).
    - Second threshold → same alert re-sent, plus service leads / admins are
                         cc'd as an escalation signal.
    - Cooldown         → tickets are not re-alerted more often than
                         SLA_ALERT_COOLDOWN_HOURS (default 4 h).

    The task is idempotent — it can be run multiple times without duplicating
    alerts, because it gates on last_stale_alert_at.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

# Statuses that are eligible for SLA breach checking.
# waiting_requester is included but carries a longer threshold — it's the
# requester's turn, but if it's been 48+ hours the ticket should still surface.
STALE_STATUSES = ('submitted', 'triaged', 'in_progress', 'waiting_requester')

# Terminal statuses — never alert on these.
TERMINAL_STATUSES = ('resolved', 'closed', 'cancelled')


def _sla_threshold_hours(status: str) -> float:
    """Return the first-alert threshold in hours for the given status."""
    return {
        'submitted':         settings.SLA_SUBMITTED_HOURS,
        'triaged':           settings.SLA_TRIAGED_HOURS,
        'in_progress':       settings.SLA_IN_PROGRESS_HOURS,
        'waiting_requester': settings.SLA_WAITING_REQUESTER_HOURS,
    }.get(status, settings.SLA_IN_PROGRESS_HOURS)


def _escalation_threshold_hours(status: str) -> float:
    """Return the escalation threshold (first × multiplier) for the given status."""
    return _sla_threshold_hours(status) * settings.SLA_ESCALATION_MULTIPLIER


def _get_service_lead_emails() -> list[str]:
    """Return email addresses of all active service leads and administrators."""
    from django.contrib.auth import get_user_model
    from .models import RoleGrant

    User = get_user_model()
    now = timezone.now()
    lead_ids = (
        RoleGrant.objects
        .filter(role__in=('service_lead', 'administrator'))
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .values_list('user_id', flat=True)
        .distinct()
    )
    return list(
        User.objects
        .filter(pk__in=lead_ids, is_active=True)
        .exclude(email='')
        .values_list('email', flat=True)
    )


@shared_task(bind=True, name='helpdesk.tasks.check_stale_tickets',
             ignore_result=True, max_retries=3, default_retry_delay=60)
def check_stale_tickets(self):
    """
    Periodic task: scan for stale tickets and fire ticket_stale notifications.
    """
    from .models import Ticket
    from .notifications import send_event

    now = timezone.now()
    helpdesk_url = getattr(settings, 'HELPDESK_URL', 'http://localhost:3000')
    cooldown_delta = timedelta(hours=settings.SLA_ALERT_COOLDOWN_HOURS)

    # Fetch all tickets that are in a stale-eligible status and are not terminal
    candidates = (
        Ticket.objects
        .filter(status__in=STALE_STATUSES)
        .select_related('category', 'requester', 'assigned_to')
    )

    alerted = 0
    escalated = 0

    for ticket in candidates:
        threshold_h    = _sla_threshold_hours(ticket.status)
        escalation_h   = _escalation_threshold_hours(ticket.status)
        threshold_dt   = timedelta(hours=threshold_h)
        escalation_dt  = timedelta(hours=escalation_h)

        # Measure age from the last REAL staff activity, not updated_at.
        #
        # Problem with updated_at: this task saves update_fields=['is_overdue',
        # 'last_stale_alert_at', 'updated_at'] which resets updated_at to now.
        # On the next run, age = now - updated_at ≈ 15 minutes < threshold,
        # so the task clears is_overdue immediately — the flag oscillates.
        #
        # Solution: if the task has previously alerted this ticket
        # (last_stale_alert_at is set), use that as the age baseline.
        # That timestamp records when the ticket was FIRST flagged, not when
        # the task last touched it.
        # If never alerted before, fall back to updated_at (real last activity).
        if ticket.last_stale_alert_at is not None:
            # Ticket was already flagged at least once — measure from when the
            # ALERT was first sent, not from the task's last save.
            age_reference = ticket.last_stale_alert_at
        else:
            age_reference = ticket.updated_at

        age = now - age_reference

        if age < threshold_dt:
            # Ticket is genuinely not yet stale — clear flag if previously set
            if ticket.is_overdue:
                ticket.is_overdue = False
                ticket.save(update_fields=['is_overdue', 'updated_at'])
            continue

        # --- Ticket is stale ---

        # Enforce cooldown: skip if we already alerted recently
        if (ticket.last_stale_alert_at is not None and
                now - ticket.last_stale_alert_at < cooldown_delta):
            # Still overdue but in cooldown — ensure flag is set
            if not ticket.is_overdue:
                ticket.is_overdue = True
                ticket.save(update_fields=['is_overdue', 'updated_at'])
            continue

        # Determine if this is an escalation (breached the second threshold)
        is_escalation = age >= escalation_dt

        # Build notification context
        requester_name = (
            ticket.requester.get_full_name() or ticket.requester.username
        ) if ticket.requester else 'Unknown'

        assignee_name = (
            ticket.assigned_to.get_full_name() or ticket.assigned_to.username
        ) if ticket.assigned_to else 'Unassigned'

        age_hours = age.total_seconds() / 3600
        context = {
            'ticket_reference': ticket.reference,
            'ticket_subject':   ticket.subject,
            'ticket_status':    ticket.status.replace('_', ' ').title(),
            'ticket_priority':  ticket.priority,
            'category_name':    ticket.category.name if ticket.category else '—',
            'requester_name':   requester_name,
            'requester_email':  ticket.requester.email if ticket.requester else '',
            'assignee_name':    assignee_name,
            'age_hours':        f'{age_hours:.1f}',
            'threshold_hours':  str(threshold_h),
            'is_escalation':    is_escalation,
            'helpdesk_url':     f'{helpdesk_url}/admin/tickets',
        }

        # Determine who to notify
        recipient_emails: list[str] = []

        if ticket.assigned_to:
            # Assigned — alert the assignee
            if ticket.assigned_to.email:
                recipient_emails.append(ticket.assigned_to.email)
            # On escalation, also loop in service leads
            if is_escalation:
                recipient_emails += _get_service_lead_emails()
        else:
            # Unassigned — always go to service leads / admins
            recipient_emails = _get_service_lead_emails()

        # Deduplicate while preserving order
        seen: set[str] = set()
        unique_recipients = [e for e in recipient_emails
                             if e not in seen and not seen.add(e)]  # type: ignore[func-returns-value]

        for email in unique_recipients:
            try:
                ctx = dict(context)
                ctx['to_email'] = email
                send_event('ticket_stale', ctx, ticket=ticket)
            except Exception as exc:
                logger.exception(
                    'Failed to send ticket_stale alert for %s to %s: %s',
                    ticket.reference, email, exc,
                )

        # Update ticket fields
        ticket.is_overdue          = True
        ticket.last_stale_alert_at = now
        ticket.save(update_fields=['is_overdue', 'last_stale_alert_at', 'updated_at'])

        if is_escalation:
            escalated += 1
        else:
            alerted += 1

    logger.info(
        'check_stale_tickets: %d alerted, %d escalated (run at %s)',
        alerted, escalated, now.isoformat(),
    )


# ---------------------------------------------------------------------------
# Auto-close resolved tickets after 7 days
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='helpdesk.tasks.auto_close_resolved_tickets',
             ignore_result=True, max_retries=3, default_retry_delay=60)
def auto_close_resolved_tickets(self):
    """
    Close tickets that have been in 'resolved' status for 7+ calendar days
    without the requester explicitly closing them.

    Spec §4.2: "Default proposal: auto-close seven calendar days after
    resolution; allow reopening during that interval."
    """
    from django.db.models import F as _F
    from .models import Ticket, TicketEvent

    cutoff = timezone.now() - timedelta(days=7)

    candidates = Ticket.objects.filter(
        status='resolved',
        updated_at__lte=cutoff,
    ).select_related('requester')

    closed = 0
    for ticket in candidates:
        try:
            old_status = ticket.status
            ticket.status = 'closed'
            ticket.version = _F('version') + 1
            ticket.save(update_fields=['status', 'version', 'updated_at'])

            TicketEvent.objects.create(
                ticket=ticket,
                actor=None,   # system action
                action=TicketEvent.Action.STATUS_CHANGED,
                old_value=old_status,
                new_value='closed',
                note='Auto-closed after 7 days in resolved state.',
            )
            closed += 1
        except Exception as exc:
            logger.exception(
                'auto_close_resolved_tickets: failed to close %s: %s',
                ticket.reference, exc,
            )

    logger.info('auto_close_resolved_tickets: closed %d tickets (run at %s)',
                closed, timezone.now().isoformat())


# ---------------------------------------------------------------------------
# NotificationOutbox delivery worker
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='helpdesk.tasks.deliver_notification_outbox',
             ignore_result=True, max_retries=3, default_retry_delay=30)
def deliver_notification_outbox(self):
    """
    Deliver pending NotificationOutbox rows.

    Picks up rows where:
      - state = pending
      - next_attempt_at is null or <= now
      - attempt_count < max_attempts

    On success: marks delivered.
    On failure: increments attempt_count, sets next_attempt_at with
                exponential back-off (1 min, 2 min, 4 min, 8 min, 16 min).
    After max_attempts: marks failed.
    """
    from django.utils import timezone as tz
    from .models import NotificationOutbox
    from .email_dispatch import resolve_and_send

    now = tz.now()
    batch = NotificationOutbox.objects.filter(
        state=NotificationOutbox.DeliveryState.PENDING,
    ).filter(
        Q(next_attempt_at__isnull=True) | Q(next_attempt_at__lte=now)
    ).exclude(
        attempt_count__gte=F('max_attempts')
    ).select_related('ticket')[:50]   # process up to 50 per run

    delivered = 0
    failed    = 0

    for item in batch:
        try:
            resolve_and_send(
                event_type=item.event_type,
                context=item.context_json,
                to_email=item.recipient_email,
                subject=item.subject,
                log_tag=f'outbox item_id={item.pk}',
            )
            item.state        = NotificationOutbox.DeliveryState.DELIVERED
            item.delivered_at = now
            item.save(update_fields=['state', 'delivered_at'])
            delivered += 1
        except Exception as exc:
            item.attempt_count  += 1
            item.last_attempt_at = now
            item.error_message   = str(exc)[:500]

            if item.attempt_count >= item.max_attempts:
                item.state = NotificationOutbox.DeliveryState.FAILED
                logger.error(
                    'deliver_notification_outbox: item %d permanently failed after %d attempts: %s',
                    item.pk, item.attempt_count, exc,
                )
                failed += 1
            else:
                # Exponential back-off: 1, 2, 4, 8, 16 minutes
                delay_minutes = 2 ** (item.attempt_count - 1)
                item.next_attempt_at = now + timedelta(minutes=delay_minutes)
                logger.warning(
                    'deliver_notification_outbox: item %d attempt %d failed, retry in %dm: %s',
                    item.pk, item.attempt_count, delay_minutes, exc,
                )

            item.save(update_fields=[
                'state', 'attempt_count', 'last_attempt_at',
                'next_attempt_at', 'error_message',
            ])

    logger.info(
        'deliver_notification_outbox: delivered=%d failed=%d (run at %s)',
        delivered, failed, now.isoformat(),
    )
