"""
helpdesk.email_verification
═══════════════════════════
Utilities for sending and managing email ownership verification.

This module is intentionally separate from notifications.py because:
  - Verification is transactional (must work even without a NotificationChannel
    configured in the DB — a cold install must still be able to verify users).
  - It uses Django's built-in email machinery (EMAIL_BACKEND) rather than the
    admin-configured SMTP/Mailgun NotificationChannel system.
  - Tokens must NEVER appear in logs or API responses.

Configuration (settings / environment)
───────────────────────────────────────
  EMAIL_BACKEND               standard Django setting; defaults to console
  EMAIL_HOST / PORT / etc.    standard Django SMTP settings
  VERIFICATION_FROM_EMAIL     sender address (default: noreply@iic.edu.np)
  VERIFICATION_TOKEN_EXPIRY_HOURS  expiry window in hours (default: 24)
  EMAIL_VERIFICATION_ENABLED  set to False to disable verification entirely
                              (for CI / development — default: True)
  HELPDESK_URL                base URL for the verification link
"""

import logging
import threading

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_DEFAULT_FROM = 'noreply@iic.edu.np'
_SUBJECT      = 'Verify your IIC IT Helpdesk account'


def _verification_enabled() -> bool:
    """Return True unless EMAIL_VERIFICATION_ENABLED is explicitly set to False."""
    return getattr(settings, 'EMAIL_VERIFICATION_ENABLED', True)


def _from_email() -> str:
    return getattr(settings, 'VERIFICATION_FROM_EMAIL', _DEFAULT_FROM)


def _helpdesk_url() -> str:
    return getattr(settings, 'HELPDESK_URL', 'http://localhost:3000').rstrip('/')


# ── Email body ────────────────────────────────────────────────────────────────

def _build_email_body(user, raw_token: str, expires_hours: int) -> tuple:
    """Return (plain_text, html) for the verification email."""
    base_url   = _helpdesk_url()
    verify_url = f'{base_url}/verify-email?token={raw_token}'
    name       = user.get_full_name() or user.username

    plain = (
        f'Hi {name},\n\n'
        f'Please verify your IIC IT Helpdesk account by visiting:\n\n'
        f'{verify_url}\n\n'
        f'This link expires in {expires_hours} hour(s).\n\n'
        f'If you did not register for this service, you can safely ignore this email.\n\n'
        f'Do not share this link with anyone.\n\n'
        f'— IIC IT & NOC Department'
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Verify your email</title></head>
<body style="font-family:Inter,ui-sans-serif,sans-serif;background:#f8fafc;margin:0;padding:32px 0;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:40px;">
        <tr><td>
          <p style="margin:0 0 4px;font-size:.75rem;font-weight:800;color:#234395;text-transform:uppercase;letter-spacing:.1em;">
            IIC IT &amp; NOC Helpdesk
          </p>
          <h1 style="margin:0 0 24px;font-size:1.6rem;color:#0f172a;letter-spacing:-.03em;">
            Verify your email address
          </h1>
          <p style="margin:0 0 16px;color:#475569;line-height:1.6;">
            Hi <strong>{name}</strong>,
          </p>
          <p style="margin:0 0 24px;color:#475569;line-height:1.6;">
            You recently registered for the IIC IT &amp; NOC Helpdesk.
            Click the button below to verify your <strong>{user.email}</strong> address
            and activate your account.
          </p>
          <p style="margin:0 0 32px;text-align:center;">
            <a href="{verify_url}"
               style="display:inline-block;background:#234395;color:#fff;
                      font-weight:750;padding:13px 28px;border-radius:10px;
                      text-decoration:none;font-size:1rem;">
              Verify email address
            </a>
          </p>
          <p style="margin:0 0 8px;color:#94a3b8;font-size:.82rem;line-height:1.55;">
            This link expires in <strong>{expires_hours} hour(s)</strong>.
            If you did not register, you can safely ignore this email.
          </p>
          <p style="margin:0;color:#94a3b8;font-size:.78rem;">
            Do not share this link with anyone.
          </p>
          <hr style="margin:28px 0;border:0;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:.75rem;">
            Itahari International College · IT &amp; NOC Department
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""
    return plain, html


# ── Public API ────────────────────────────────────────────────────────────────

def send_verification_email(user) -> None:
    """
    Generate a new EmailVerificationToken for *user* and dispatch the
    verification email in a daemon thread so callers are never blocked.

    SECURITY: the raw token is passed only to the email body and is NEVER
    logged, stored, or returned to the caller.

    If EMAIL_VERIFICATION_ENABLED is False (e.g. in CI), this is a no-op and
    a DEBUG log message is written instead.
    """
    if not _verification_enabled():
        logger.debug(
            'Email verification disabled (EMAIL_VERIFICATION_ENABLED=False). '
            'Skipping verification email for %s.', user.email
        )
        return

    from .models import EmailVerificationToken
    expiry_hours = int(getattr(settings, 'VERIFICATION_TOKEN_EXPIRY_HOURS', 24))
    raw_token, _token_obj = EmailVerificationToken.create_for_user(user)

    plain, html = _build_email_body(user, raw_token, expiry_hours)

    def _send():
        try:
            send_mail(
                subject=_SUBJECT,
                message=plain,
                from_email=_from_email(),
                recipient_list=[user.email],
                html_message=html,
                fail_silently=False,
            )
            logger.info('Verification email dispatched to %s.', user.email)
        except Exception as exc:
            # Log the error (without the token) and do NOT re-raise.
            # The registration still succeeded; the user can request a resend.
            logger.error(
                'Failed to send verification email to %s: %s',
                user.email, exc,
            )

    t = threading.Thread(target=_send, daemon=True)
    t.start()


def verify_token_and_activate(raw_token: str) -> object:
    """
    Validate *raw_token*, mark the token as used, and activate the user.

    Returns the User instance on success.
    Raises ValueError with a generic message on any failure.

    The entire activation is wrapped in an atomic transaction so a failure
    in any step leaves both the token and the user unchanged.
    """
    from django.db import transaction
    from django.utils import timezone
    from .models import EmailVerificationToken

    with transaction.atomic():
        token = EmailVerificationToken.verify(raw_token)  # raises ValueError on failure

        user    = token.user
        profile = user.profile  # UserProfile is always created by signal

        # Mark token used
        token.verified_at = timezone.now()
        token.save(update_fields=['verified_at'])

        # Activate user
        user.is_active = True
        user.save(update_fields=['is_active'])

        # Mark email verified on profile
        if not profile.email_verified:
            profile.email_verified    = True
            profile.email_verified_at = timezone.now()
            profile.save(update_fields=['email_verified', 'email_verified_at'])

    return user
