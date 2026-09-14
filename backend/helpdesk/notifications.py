"""
Notification sending module.

Supports: Discord, Google Workspace, Teams, Slack (webhook),
          SMTP email, Mailgun email.

All sends are fire-and-forget — errors are logged but never raised.
"""

import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests as http_requests
from django.template import Context, Template

logger = logging.getLogger(__name__)

# ── Secret field names per channel type ───────────────────────────────────────

SECRET_FIELDS = {
    'discord': ['webhook_url'],
    'google_workspace': ['webhook_url'],
    'teams': ['webhook_url'],
    'slack': ['webhook_url'],
    'email_smtp': ['password'],
    'email_mailgun': ['api_key'],
}

MASK = '••••••••'


def mask_config(channel_type: str, config: dict) -> dict:
    """Return a copy of config with secret fields replaced by MASK."""
    masked = dict(config)
    for field in SECRET_FIELDS.get(channel_type, []):
        if field in masked:
            masked[field] = MASK
    return masked


def merge_config(channel_type: str, stored_config: dict, incoming_config: dict) -> dict:
    """Merge incoming PATCH config, keeping stored secrets if masked value submitted."""
    merged = dict(stored_config)
    for key, value in incoming_config.items():
        if key in SECRET_FIELDS.get(channel_type, []) and value == MASK:
            pass  # keep stored value
        else:
            merged[key] = value
    return merged


def render_template(template_str: str, context: dict) -> str:
    """Render a Django template string with the given context."""
    try:
        t = Template(template_str)
        return t.render(Context(context, autoescape=False))
    except Exception as exc:
        logger.warning('Template render error: %s', exc)
        return template_str


# ── Webhook senders ────────────────────────────────────────────────────────────

def send_webhook(webhook_url: str, text: str, channel_type: str) -> tuple:
    """Send a plain-text message to a Discord/Teams/Slack/Google webhook."""
    try:
        if channel_type == 'discord':
            payload = {'content': text}
        elif channel_type == 'teams':
            payload = {'text': text}
        elif channel_type == 'slack':
            payload = {'text': text}
        elif channel_type == 'google_workspace':
            payload = {'text': text}
        else:
            payload = {'text': text}

        response = http_requests.post(
            webhook_url, json=payload, timeout=10
        )
        if response.status_code in (200, 204):
            return True, 'Message sent successfully.'
        return False, f'HTTP {response.status_code}: {response.text[:200]}'
    except Exception as exc:
        return False, str(exc)


# ── SMTP email sender ──────────────────────────────────────────────────────────

def send_smtp(config: dict, to_email: str, subject: str, html_body: str) -> tuple:
    """Send an email via SMTP with app password."""
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = config['from_email']
        msg['To'] = to_email
        msg.attach(MIMEText(html_body, 'html'))

        use_ssl = config.get('use_ssl', False)
        use_tls = config.get('use_tls', True)
        host = config['host']
        port = int(config.get('port', 587))
        username = config['username']
        password = config['password']

        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                server.login(username, password)
                server.sendmail(config['from_email'], to_email, msg.as_string())
        else:
            with smtplib.SMTP(host, port) as server:
                if use_tls:
                    server.starttls()
                server.login(username, password)
                server.sendmail(config['from_email'], to_email, msg.as_string())

        return True, 'Email sent successfully.'
    except Exception as exc:
        return False, str(exc)


# ── Mailgun email sender ────────────────────────────────────────────────────────

def send_mailgun(config: dict, to_email: str, subject: str, html_body: str) -> tuple:
    """Send an email via Mailgun API."""
    try:
        api_url = config['api_url'].rstrip('/')
        domain = config['domain']
        url = f'{api_url}/{domain}/messages'
        response = http_requests.post(
            url,
            auth=('api', config['api_key']),
            data={
                'from': config['from_email'],
                'to': to_email,
                'subject': subject,
                'html': html_body,
            },
            timeout=10,
        )
        if response.status_code in (200, 201):
            return True, 'Email sent via Mailgun.'
        return False, f'Mailgun HTTP {response.status_code}: {response.text[:200]}'
    except Exception as exc:
        return False, str(exc)


# ── Main dispatcher ────────────────────────────────────────────────────────────

def send_to_channel(channel, event_type: str, context: dict, ticket=None) -> tuple:
    """
    Send a notification to a single channel.
    Returns (success: bool, message: str).
    Logs the result and saves a NotificationLog.
    """
    from .models import NotificationLog, EmailTemplate  # local import to avoid circular

    config = channel.config
    success, message = False, 'Unknown error'

    try:
        ctype = channel.type

        if ctype in ('discord', 'google_workspace', 'teams', 'slack'):
            # Build plain-text message from context
            text = build_webhook_text(event_type, context)
            success, message = send_webhook(config['webhook_url'], text, ctype)

        elif ctype in ('email_smtp', 'email_mailgun'):
            # Find active template
            template = EmailTemplate.objects.filter(
                event_type=event_type, is_active=True
            ).first()
            if not template:
                return True, 'No active template — skipped.'

            to_email = context.get('to_email') or context.get('requester_email', '')
            if not to_email:
                return True, 'No recipient email — skipped.'

            subject = render_template(template.subject_template, context)
            body = render_template(template.body_html_template, context)

            if ctype == 'email_smtp':
                success, message = send_smtp(config, to_email, subject, body)
            else:
                success, message = send_mailgun(config, to_email, subject, body)

    except Exception as exc:
        success, message = False, str(exc)
        logger.exception('Notification send error: %s', exc)

    # Log the attempt
    try:
        NotificationLog.objects.create(
            channel=channel,
            event_type=event_type,
            ticket=ticket,
            status='sent' if success else 'failed',
            error_message='' if success else message,
        )
    except Exception as log_exc:
        logger.warning('Failed to write NotificationLog: %s', log_exc)

    if not success:
        logger.warning('Notification failed [%s/%s]: %s', channel.name, event_type, message)

    return success, message


def send_event(event_type: str, context: dict, ticket=None):
    """
    Send notifications to channels that have an active rule for this event.
    Falls back to all active channels if no rules exist for this event
    (backward-compatible: behaves like before if no rules are configured).
    """
    from .models import NotificationChannel, NotificationRule

    rules = NotificationRule.objects.filter(
        event_type=event_type, is_active=True
    ).select_related('channel')

    if rules.exists():
        # Rules configured — use them
        for rule in rules:
            if not rule.channel.is_active:
                continue
            # Build recipient list for email channels
            rule_context = dict(context)
            if rule.channel.type in ('email_smtp', 'email_mailgun'):
                recipients = _resolve_recipients(rule, context, ticket)
                if not recipients:
                    continue
                for recipient_email in recipients:
                    ctx = dict(rule_context)
                    ctx['to_email'] = recipient_email
                    try:
                        send_to_channel(rule.channel, event_type, ctx, ticket=ticket)
                    except Exception as exc:
                        logger.exception(
                            'Error sending to channel %s for rule %s: %s',
                            rule.channel.id, rule.id, exc
                        )
            else:
                # Webhook channels — send once per rule
                try:
                    send_to_channel(rule.channel, event_type, rule_context, ticket=ticket)
                except Exception as exc:
                    logger.exception(
                        'Error sending to channel %s for rule %s: %s',
                        rule.channel.id, rule.id, exc
                    )
    else:
        # No rules configured — fall back to all active channels (backward compat)
        channels = NotificationChannel.objects.filter(is_active=True)
        for channel in channels:
            try:
                send_to_channel(channel, event_type, context, ticket=ticket)
            except Exception as exc:
                logger.exception('Unexpected error sending to channel %s: %s', channel.id, exc)


def _resolve_recipients(rule, context: dict, ticket) -> list:
    """
    Resolve the list of email addresses for a rule based on recipient_type.
    """
    from django.contrib.auth import get_user_model
    from .models import RoleGrant

    rtype = rule.recipient_type

    if rtype == 'requester':
        email = context.get('requester_email') or context.get('to_email', '')
        return [email] if email else []

    elif rtype == 'assignee':
        if ticket and ticket.assigned_to:
            email = ticket.assigned_to.email
            return [email] if email else []
        return []

    elif rtype == 'all_staff':
        # All active users with a staff role
        User = get_user_model()
        from django.utils import timezone as tz
        from django.db.models import Q
        now = tz.now()
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        staff_ids = RoleGrant.objects.filter(
            role__in=staff_roles,
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        ).values_list('user_id', flat=True).distinct()
        emails = list(
            User.objects.filter(pk__in=staff_ids, is_active=True)
            .exclude(email='')
            .values_list('email', flat=True)
        )
        return emails

    elif rtype == 'custom':
        raw = rule.custom_emails or ''
        return [e.strip() for e in raw.split(',') if e.strip()]

    return []


def build_webhook_text(event_type: str, context: dict) -> str:
    """Build a plain-text webhook message for a given event."""
    ref = context.get('ticket_reference', '')
    subject = context.get('ticket_subject', '')
    requester = context.get('requester_name', '')
    url = context.get('helpdesk_url', '')

    if event_type == 'ticket_submitted':
        return (
            f'🎫 New ticket {ref}: {subject}\n'
            f'Submitted by: {requester}\n'
            f'Category: {context.get("category_name", "")}\n'
            f'{url}'
        )
    elif event_type == 'ticket_resolved':
        return (
            f'✅ Ticket {ref} resolved: {subject}\n'
            f'Requester: {requester}\n'
            f'{url}'
        )
    elif event_type == 'ticket_assigned':
        return (
            f'👤 Ticket {ref} assigned to {context.get("assignee_name", "")}\n'
            f'Subject: {subject}\n'
            f'{url}'
        )
    elif event_type == 'status_changed':
        return (
            f'🔄 Ticket {ref} status: {context.get("old_status", "")} → {context.get("new_status", "")}\n'
            f'Subject: {subject}\n'
            f'{url}'
        )
    elif event_type == 'account_recovery':
        return (
            f'🔐 Account recovery request from {requester}\n'
            f'Email: {context.get("college_email", "")}\n'
            f'{url}'
        )
    else:
        return f'IIC Helpdesk notification [{event_type}]: {ref} — {subject}'


def test_channel(channel_type: str, config: dict) -> tuple:
    """Send a test message to verify channel config. Does not require saving."""
    text = (
        '🧪 IIC Helpdesk — Test Notification\n'
        'This is a test message confirming your notification channel is configured correctly.\n'
        f'Channel type: {channel_type}'
    )

    if channel_type in ('discord', 'google_workspace', 'teams', 'slack'):
        return send_webhook(config.get('webhook_url', ''), text, channel_type)

    elif channel_type == 'email_smtp':
        to = config.get('from_email', '')
        subject = 'IIC Helpdesk — Test Email'
        body = '<p>This is a <strong>test notification</strong> from the IIC IT Helpdesk.</p><p>Your SMTP configuration is working correctly.</p>'
        return send_smtp(config, to, subject, body)

    elif channel_type == 'email_mailgun':
        to = config.get('from_email', '')
        subject = 'IIC Helpdesk — Test Email (Mailgun)'
        body = '<p>This is a <strong>test notification</strong> from the IIC IT Helpdesk.</p><p>Your Mailgun configuration is working correctly.</p>'
        return send_mailgun(config, to, subject, body)

    return False, f'Unknown channel type: {channel_type}'
