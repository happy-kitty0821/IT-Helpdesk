"""
helpdesk.email_verification
═══════════════════════════
Utilities for sending and managing email ownership verification.

Email transport is resolved via email_config_service.get_effective_mailer(),
which applies the DB-override → .env fallback → default precedence chain.

Token security
──────────────
- Raw token (32 random bytes, 64-char hex) is NEVER stored.
- Only the SHA-256 digest is persisted.
- The raw token is passed ONLY inside the email body — never logged or returned.

Django 6.1 compatibility
────────────────────────
- Uses django.core.mail.send_mail() which routes through MAILERS["default"].
- Never references legacy EMAIL_* settings.
- email_config_service.apply_mailers_override() keeps MAILERS in sync with DB.
"""

import logging
import threading

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)

_DEFAULT_FROM = 'noreply@iic.edu.np'
_SUBJECT      = 'Verify your IIC IT Helpdesk account'


# ── Configuration helpers (DB-override aware) ─────────────────────────────────

def _verification_enabled() -> bool:
    """Return True unless verification is explicitly disabled."""
    try:
        from .email_config_service import is_verification_enabled
        return is_verification_enabled()
    except Exception:
        return getattr(settings, 'EMAIL_VERIFICATION_ENABLED', True)


def _from_email() -> str:
    try:
        from .email_config_service import get_effective_from_email
        return get_effective_from_email()
    except Exception:
        return getattr(settings, 'VERIFICATION_FROM_EMAIL', _DEFAULT_FROM)


def _expiry_hours() -> int:
    try:
        from .email_config_service import get_verification_expiry_hours
        return get_verification_expiry_hours()
    except Exception:
        return int(getattr(settings, 'VERIFICATION_TOKEN_EXPIRY_HOURS', 24))


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
    verification email in a daemon thread so the caller is never blocked.

    Uses django.core.mail.send_mail() routed through the effective
    MAILERS["default"] (DB-override or .env fallback).

    SECURITY:
      - The raw token is captured only inside the _send() closure.
      - It is NEVER logged, stored in any attribute, or returned.
      - Credentials come from the DB/env via settings.MAILERS, not from
        any argument to this function.
    """
    if not _verification_enabled():
        logger.debug(
            'Email verification disabled. Skipping for user id=%s.', user.pk
        )
        return

    from .models import EmailVerificationToken
    expiry_hours = _expiry_hours()
    raw_token, _token_obj = EmailVerificationToken.create_for_user(user)

    plain, html = _build_email_body(user, raw_token, expiry_hours)
    recipient   = user.email
    from_addr   = _from_email()

    def _send():
        try:
            send_mail(
                subject=_SUBJECT,
                message=plain,
                from_email=from_addr,
                recipient_list=[recipient],
                html_message=html,
                # No deprecated connection/fail_silently args (Django 6.1)
            )
            logger.info('Verification email dispatched for user id=%s.', user.pk)
        except Exception as exc:
            logger.error(
                'Failed to send verification email for user id=%s: %s',
                user.pk, type(exc).__name__,
                # Deliberately NOT logging exc.args — may contain SMTP credentials
            )

    threading.Thread(target=_send, daemon=True).start()


def verify_token_and_activate(raw_token: str) -> object:
    """
    Validate *raw_token*, mark the token as used, and activate the user.

    Returns the User instance on success.
    Raises ValueError with a generic message on any failure.
    """
    from django.db import transaction
    from django.utils import timezone
    from .models import EmailVerificationToken

    with transaction.atomic():
        token   = EmailVerificationToken.verify(raw_token)
        user    = token.user
        profile = user.profile

        token.verified_at = timezone.now()
        token.save(update_fields=['verified_at'])

        user.is_active = True
        user.save(update_fields=['is_active'])

        if not profile.email_verified:
            profile.email_verified    = True
            profile.email_verified_at = timezone.now()
            profile.save(update_fields=['email_verified', 'email_verified_at'])

    return user
