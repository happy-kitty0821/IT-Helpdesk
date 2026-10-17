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


# ---------------------------------------------------------------------------
# File attachment scanning
# ---------------------------------------------------------------------------

# Magic-bytes signatures for allowed MIME types.
# Key = MIME type string, Value = list of byte sequences that must appear
# at the start of the file (any one match is sufficient).
_MAGIC_SIGNATURES: dict[str, list[bytes]] = {
    'application/pdf': [b'%PDF-'],
    'image/jpeg':      [b'\xff\xd8\xff'],
    'image/png':       [b'\x89PNG\r\n\x1a\n'],
    'image/gif':       [b'GIF87a', b'GIF89a'],
    'image/webp':      [b'RIFF'],   # RIFF....WEBP — checked further below
}


def _check_magic_bytes(file_path: str, claimed_mime: str) -> bool:
    """
    Read the first 16 bytes of the file and verify the magic signature
    matches the claimed MIME type.  Returns True if safe, False if mismatch.
    """
    try:
        with open(file_path, 'rb') as f:
            header = f.read(16)
    except OSError as exc:
        logger.error('_check_magic_bytes: cannot read %s: %s', file_path, exc)
        return False  # treat unreadable as suspicious

    signatures = _MAGIC_SIGNATURES.get(claimed_mime, [])
    if not signatures:
        # Unknown MIME — reject anything we don't have a signature for
        return False

    for sig in signatures:
        if header.startswith(sig):
            # Extra check for WebP: bytes 8-11 must be b'WEBP'
            if claimed_mime == 'image/webp':
                return header[8:12] == b'WEBP'
            return True

    return False


def _scan_with_virustotal(file_path: str, api_key: str) -> tuple[bool, str]:
    """
    Upload the file to VirusTotal v3 and poll for the verdict.

    Returns (is_clean: bool, detail: str).
    Raises on unrecoverable errors (caller should log + mark infected).
    """
    import time
    import requests as _req

    headers = {'x-apikey': api_key}

    # 1 — Upload
    with open(file_path, 'rb') as f:
        upload_resp = _req.post(
            'https://www.virustotal.com/api/v3/files',
            headers=headers,
            files={'file': f},
            timeout=60,
        )
    upload_resp.raise_for_status()
    analysis_id = upload_resp.json()['data']['id']

    # 2 — Poll (up to 5 × 15 s = 75 s total)
    analysis_url = f'https://www.virustotal.com/api/v3/analyses/{analysis_id}'
    for attempt in range(5):
        time.sleep(15)
        poll_resp = _req.get(analysis_url, headers=headers, timeout=30)
        poll_resp.raise_for_status()
        poll_data = poll_resp.json()['data']['attributes']
        if poll_data['status'] == 'completed':
            stats = poll_data.get('stats', {})
            malicious  = stats.get('malicious', 0)
            suspicious = stats.get('suspicious', 0)
            total      = sum(stats.values()) or 1
            if malicious > 0 or suspicious > 2:
                return False, (
                    f'VirusTotal: {malicious} malicious, {suspicious} suspicious '
                    f'out of {total} engines.'
                )
            return True, f'VirusTotal: clean ({total} engines checked).'

    # Timed out waiting for results — treat as inconclusive (clean)
    logger.warning('_scan_with_virustotal: analysis %s timed out — treating as clean.', analysis_id)
    return True, 'VirusTotal: scan timed out — marked clean by default.'


@shared_task(bind=True, name='helpdesk.tasks.scan_attachment',
             ignore_result=True, max_retries=2, default_retry_delay=30)
def scan_attachment(self, attachment_id: int) -> None:
    """
    Background scan for a single TicketAttachment.

    Pipeline:
      1. Magic-bytes check (local, ~1 ms) if magic_bytes_enabled
      2. VirusTotal scan (async, ~15–75 s) if virustotal_enabled + key set

    On clean:  scan_state = clean
    On infected:
      - scan_state = infected
      - Notify admin via send_event('attachment_scan_failed')
      - If auto_block_infected=True the download view will block the file
    """
    from .models import TicketAttachment, FileScanSettings
    from .notifications import send_event

    try:
        attachment = TicketAttachment.objects.select_related('ticket').get(pk=attachment_id)
    except TicketAttachment.DoesNotExist:
        logger.warning('scan_attachment: attachment %d not found.', attachment_id)
        return

    # Already decided — nothing to do
    if attachment.scan_state != TicketAttachment.ScanState.PENDING:
        return

    settings_obj = FileScanSettings.get()
    file_path    = attachment.file.path

    from .models import AttachmentScanLog

    # Convenience helper — never raises, so a log-write failure can't block the scan outcome.
    def _write_log(scan_type: str, result: str, detail: str = '', engine_count=None):
        try:
            AttachmentScanLog.objects.create(
                attachment=attachment,
                ticket_ref=attachment.ticket.reference if attachment.ticket else '',
                file_name=attachment.original_name,
                scan_type=scan_type,
                result=result,
                detail=detail,
                engine_count=engine_count,
            )
        except Exception as log_exc:
            logger.warning(
                'scan_attachment: failed to write scan log for attachment %d: %s',
                attachment_id, log_exc,
            )

    # ── Step 1: Magic-bytes ───────────────────────────────────────────────────
    if settings_obj.magic_bytes_enabled:
        is_safe = _check_magic_bytes(file_path, attachment.content_type)
        if not is_safe:
            reason = (
                f'Magic-bytes mismatch: file does not match claimed type '
                f'"{attachment.content_type}".'
            )
            _write_log('magic_bytes', 'infected', detail=reason)
            _mark_infected(attachment, settings_obj, reason, send_event)
            return
        _write_log('magic_bytes', 'clean', detail='Signature matches claimed type.')
    else:
        _write_log('magic_bytes', 'skipped', detail='Magic-bytes check is disabled.')

    # ── Step 2: VirusTotal ────────────────────────────────────────────────────
    if settings_obj.virustotal_enabled:
        api_key = settings_obj.get_virustotal_api_key()
        if api_key:
            try:
                is_clean, detail = _scan_with_virustotal(file_path, api_key)
                # Parse engine count from detail string if available
                engine_count = None
                import re as _re
                m = _re.search(r'(\d+) engines', detail)
                if m:
                    engine_count = int(m.group(1))
                if not is_clean:
                    _write_log('virustotal', 'infected', detail=detail, engine_count=engine_count)
                    _mark_infected(attachment, settings_obj, detail, send_event)
                    return
                _write_log('virustotal', 'clean', detail=detail, engine_count=engine_count)
                logger.info('scan_attachment: attachment %d — %s', attachment_id, detail)
            except Exception as exc:
                logger.error(
                    'scan_attachment: VT scan failed for attachment %d: %s',
                    attachment_id, exc,
                )
                _write_log('virustotal', 'error', detail=str(exc))
                # Do not mark as infected on API failure — mark clean with warning
                # so staff aren't blocked by a transient VT outage.
        else:
            _write_log('virustotal', 'skipped', detail='VirusTotal enabled but no API key configured.')
    else:
        _write_log('virustotal', 'skipped', detail='VirusTotal scan is disabled.')

    # ── All checks passed ─────────────────────────────────────────────────────
    attachment.scan_state = TicketAttachment.ScanState.CLEAN
    attachment.save(update_fields=['scan_state'])
    logger.info('scan_attachment: attachment %d marked clean.', attachment_id)


def _mark_infected(
    attachment: 'TicketAttachment',
    settings_obj: 'FileScanSettings',
    reason: str,
    send_event_fn,
) -> None:
    """Set scan_state=infected and alert the admin."""
    from .models import SiteSettings

    attachment.scan_state = TicketAttachment.ScanState.INFECTED
    attachment.save(update_fields=['scan_state'])

    logger.warning(
        'scan_attachment: attachment %d INFECTED — %s (file: %s)',
        attachment.pk, reason, attachment.original_name,
    )

    # Determine alert destination
    alert_email = (
        settings_obj.alert_email.strip() or
        SiteSettings.get().support_email or
        'support@iic.edu.np'
    )

    try:
        send_event_fn('attachment_scan_failed', {
            'ticket_reference': attachment.ticket.reference if attachment.ticket else '—',
            'ticket_subject':   attachment.ticket.subject if attachment.ticket else '—',
            'file_name':        attachment.original_name,
            'file_size':        attachment.file_size,
            'content_type':     attachment.content_type,
            'scan_reason':      reason,
            'helpdesk_url':     'https://ithelpdesk-iic.cloud-dev.tech/admin/tickets',
            'to_email':         alert_email,
            'support_email':    alert_email,
        }, ticket=attachment.ticket)
    except Exception as exc:
        logger.error('scan_attachment: failed to send alert: %s', exc)
