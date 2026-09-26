"""
helpdesk.email_utils
═════════════════════
Thin helpers for rendering and dispatching transactional emails.

All HTML bodies live in helpdesk/templates/email/*.html so they can be
edited without touching Python code.  Plain-text bodies are still built
in the calling code because they don't benefit from a template engine —
they are short and contain no shared layout.

Usage
─────
    from helpdesk.email_utils import render_email, send_email_async

    html = render_email('email/password_reset.html', {
        'name':         user.get_full_name(),
        'reset_url':    reset_url,
        'expiry_hours': 2,
    })

    send_email_async(
        subject  = '[IIC IT Helpdesk] Reset your password',
        plain    = plain_text_body,
        html     = html,
        to       = user.email,
        from_email = get_effective_from_email(),
        log_tag  = f'password_reset user_id={user.pk}',
    )
"""

import logging
import threading

logger = logging.getLogger(__name__)


def render_email(template_name: str, context: dict) -> str:
    """
    Render *template_name* with *context* and return the HTML string.

    Template names are relative to the Django template loader root, e.g.
    ``'email/recovery_credentials.html'``.

    Raises ``django.template.TemplateDoesNotExist`` if the file is missing —
    let that propagate so misconfiguration is immediately visible.
    """
    from django.template.loader import render_to_string
    return render_to_string(template_name, context)


def send_email_async(
    *,
    subject: str,
    plain: str,
    html: str,
    to: str,
    from_email: str,
    log_tag: str = '',
) -> None:
    """
    Dispatch a single transactional email in a daemon thread so the HTTP
    request is never blocked waiting on SMTP.

    Parameters
    ----------
    subject    : Email subject line.
    plain      : Plain-text fallback body (required by RFC 2822).
    html       : HTML body rendered via render_email().
    to         : Single recipient address.
    from_email : Sender address (from get_effective_from_email()).
    log_tag    : Short string appended to log messages for tracing, e.g.
                 ``'password_reset user_id=42'``.
    """
    from django.core.mail import send_mail

    tag = f' [{log_tag}]' if log_tag else ''

    def _send() -> None:
        try:
            send_mail(
                subject=subject,
                message=plain,
                from_email=from_email,
                recipient_list=[to],
                html_message=html,
            )
            logger.info('Email sent%s to %s.', tag, to)
        except Exception as exc:
            # Deliberately NOT logging exc.args — may contain SMTP credentials.
            logger.error(
                'Failed to send email%s to %s: %s',
                tag, to, type(exc).__name__,
            )

    threading.Thread(target=_send, daemon=True).start()
