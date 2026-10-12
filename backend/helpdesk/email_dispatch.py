"""
helpdesk.email_dispatch
════════════════════════
Single entry point for every outgoing email in the helpdesk.

Usage
─────
    from helpdesk.email_dispatch import resolve_and_send

    resolve_and_send(
        event_type = 'email_verification',
        context    = {
            'name':          user.get_full_name(),
            'email':         user.email,
            'verify_url':    verify_url,
            'expires_hours': 24,
            'support_email': 'support@iic.edu.np',
            'helpdesk_url':  'https://helpdesk.iic.edu.np',
        },
        to_email   = user.email,
        subject    = 'Verify your IIC IT Helpdesk account',
    )

How it works
────────────
1. Template resolution (DB first, file fallback)
   ─────────────────────────────────────────────
   Looks for an active EmailTemplate row for *event_type*.
   If found, renders its subject_template and body_html_template with
   Django's template engine, so admins can customise the copy at runtime.
   If not found (or deactivated), falls back to the on-disk HTML file at
   ``helpdesk/templates/email/{event_type}.html``.
   The on-disk file is the safe baseline — it is never deleted.

2. Transport resolution (channel → DB config → .env)
   ────────────────────────────────────────────────────
   Calls email_config_service.resolve_transport(event_type) which returns
   the highest-priority available transport:
     a. NotificationChannel (email_smtp / email_mailgun) with a rule for
        this event_type — lets admins route specific events via specific
        providers (e.g. Mailgun for ticket alerts, SMTP for verification).
     b. Active EmailConfiguration DB row — global SMTP override.
     c. settings.MAILERS["default"] built from MAILER_* env vars.

3. Dispatch
   ─────────
   smtp / django_mailer → send_email_async (non-blocking daemon thread)
   mailgun              → Mailgun HTTP API (also wrapped in a daemon thread)

All sends are fire-and-forget. Errors are logged but never raised to the
caller so a broken SMTP config never crashes a user-facing request.
"""

import logging
import threading

logger = logging.getLogger(__name__)


# ── Template resolution ───────────────────────────────────────────────────────

def _resolve_template(event_type: str, context: dict) -> tuple[str, str] | tuple[None, None]:
    """
    Return (subject, html_body) for *event_type*, or (None, None) if the
    on-disk fallback template also doesn't exist.

    Precedence:
      1. Active EmailTemplate DB row for event_type
      2. On-disk file at templates/email/{event_type}.html
    """
    # 1 — DB template
    try:
        from .models import EmailTemplate
        from django.template import Context, Template as DjangoTemplate

        db_tmpl = EmailTemplate.objects.filter(
            event_type=event_type, is_active=True
        ).first()

        if db_tmpl:
            if db_tmpl.use_file_fallback:
                # Admin explicitly chose "use default file template" — skip to file
                logger.debug(
                    '_resolve_template[%s]: DB template exists but use_file_fallback=True,'
                    ' using on-disk file.', event_type
                )
            else:
                def _render(src: str) -> str:
                    try:
                        return DjangoTemplate(src).render(Context(context, autoescape=False))
                    except Exception as exc:
                        logger.warning('DB template render error for %s: %s', event_type, exc)
                        return src

                return _render(db_tmpl.subject_template), _render(db_tmpl.body_html_template)
    except Exception as exc:
        logger.debug('_resolve_template DB lookup failed (%s)', type(exc).__name__)

    # 2 — On-disk fallback
    try:
        from django.template.loader import render_to_string
        html = render_to_string(f'email/{event_type}.html', context)
        return None, html   # subject comes from the caller when using file fallback
    except Exception:
        pass   # template file doesn't exist — caller must supply subject + html

    return None, None


# ── Transport dispatch ────────────────────────────────────────────────────────

def _dispatch_smtp(config: dict, to_email: str, subject: str, html_body: str,
                   from_email: str, log_tag: str, event_type: str = '') -> None:
    """Raw smtplib send — used for NotificationChannel email_smtp transport."""
    import smtplib
    import ssl
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    def _send() -> None:
        success = False
        error_msg = ''
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From']    = from_email
            msg['To']      = to_email
            msg.attach(MIMEText(html_body, 'html'))

            use_ssl = config.get('use_ssl', False)
            use_tls = config.get('use_tls', True)
            host    = config['host']
            port    = int(config.get('port', 587))

            if use_ssl:
                ctx = ssl.create_default_context()
                with smtplib.SMTP_SSL(host, port, context=ctx) as srv:
                    srv.login(config['username'], config['password'])
                    srv.sendmail(from_email, to_email, msg.as_string())
            else:
                with smtplib.SMTP(host, port) as srv:
                    if use_tls:
                        srv.starttls()
                    srv.login(config['username'], config['password'])
                    srv.sendmail(from_email, to_email, msg.as_string())

            success = True
            logger.info('Email [%s] sent to %s via SMTP channel.', log_tag, to_email)
        except Exception as exc:
            error_msg = type(exc).__name__
            logger.error('SMTP channel send failed [%s] to %s: %s', log_tag, to_email, error_msg)
        finally:
            _write_transactional_log(event_type, success, error_msg)

    threading.Thread(target=_send, daemon=True).start()


def _dispatch_mailgun(config: dict, to_email: str, subject: str, html_body: str,
                      from_email: str, log_tag: str, event_type: str = '') -> None:
    """Mailgun HTTP API send — used for NotificationChannel email_mailgun transport."""
    import requests as http_requests

    def _send() -> None:
        success = False
        error_msg = ''
        try:
            api_url = config['api_url'].rstrip('/')
            domain  = config['domain']
            url     = f'{api_url}/{domain}/messages'
            resp    = http_requests.post(
                url,
                auth=('api', config['api_key']),
                data={'from': from_email, 'to': to_email,
                      'subject': subject, 'html': html_body},
                timeout=10,
            )
            if resp.status_code in (200, 201):
                success = True
                logger.info('Email [%s] sent to %s via Mailgun.', log_tag, to_email)
            else:
                error_msg = f'HTTP {resp.status_code}'
                logger.error('Mailgun send failed [%s]: %s %s', log_tag, error_msg, resp.text[:200])
        except Exception as exc:
            error_msg = type(exc).__name__
            logger.error('Mailgun send failed [%s] to %s: %s', log_tag, to_email, error_msg)
        finally:
            _write_transactional_log(event_type, success, error_msg)

    threading.Thread(target=_send, daemon=True).start()


def _dispatch_django_mailer(to_email: str, subject: str, html_body: str,
                             from_email: str, log_tag: str, event_type: str = '') -> None:
    """Django send_mail() — routes through settings.MAILERS["default"]."""
    from django.core.mail import send_mail

    def _send() -> None:
        success = False
        error_msg = ''
        try:
            send_mail(
                subject=subject,
                message='',          # plain-text fallback — modern clients use HTML
                from_email=from_email,
                recipient_list=[to_email],
                html_message=html_body,
            )
            success = True
            logger.info('Email [%s] sent to %s via Django mailer.', log_tag, to_email)
        except Exception as exc:
            error_msg = type(exc).__name__
            logger.error('Django mailer send failed [%s] to %s: %s', log_tag, to_email, error_msg)
        finally:
            _write_transactional_log(event_type, success, error_msg)

    threading.Thread(target=_send, daemon=True).start()


def _write_transactional_log(event_type: str, success: bool, error_msg: str) -> None:
    """Write a NotificationLog entry for a transactional (non-channel) email send."""
    if not event_type:
        return
    try:
        from .models import NotificationLog
        NotificationLog.objects.create(
            channel=None,        # no channel — transactional send
            event_type=event_type,
            ticket=None,
            status='sent' if success else 'failed',
            error_message='' if success else error_msg,
        )
    except Exception as exc:
        logger.warning('_write_transactional_log failed for %s: %s', event_type, exc)


# ── Public API ────────────────────────────────────────────────────────────────

def resolve_and_send(
    *,
    event_type: str,
    context: dict,
    to_email: str,
    subject: str = '',
    log_tag: str = '',
) -> None:
    """
    Resolve the best available template and transport for *event_type* and
    dispatch the email in a daemon thread.

    Parameters
    ----------
    event_type : EventType slug, e.g. 'email_verification', 'password_reset'.
    context    : Template variables available inside {{ }}.
    to_email   : Recipient address.
    subject    : Default subject — overridden by DB template subject if one exists.
    log_tag    : Short string for log messages, e.g. 'verify user_id=42'.
    """
    if not to_email:
        logger.warning('resolve_and_send[%s]: no to_email — skipping.', event_type)
        return

    tag = log_tag or event_type

    # 1 — Resolve template
    resolved_subject, html_body = _resolve_template(event_type, context)

    if html_body is None:
        logger.error(
            'resolve_and_send[%s]: no template found (DB or file) — email not sent.',
            event_type,
        )
        return

    final_subject = resolved_subject or subject or f'IIC IT Helpdesk — {event_type.replace("_", " ").title()}'

    # 2 — Resolve transport
    from .email_config_service import resolve_transport
    transport = resolve_transport(event_type)

    from_email = transport.get('from_email') or context.get('support_email', 'noreply@iic.edu.np')
    backend    = transport['backend']

    # 3 — Dispatch
    if backend == 'smtp':
        _dispatch_smtp(transport['config'], to_email, final_subject, html_body,
                       from_email, tag, event_type)
    elif backend == 'mailgun':
        _dispatch_mailgun(transport['config'], to_email, final_subject, html_body,
                          from_email, tag, event_type)
    else:
        # django_mailer — applies current MAILERS["default"]
        _dispatch_django_mailer(to_email, final_subject, html_body, from_email, tag, event_type)
