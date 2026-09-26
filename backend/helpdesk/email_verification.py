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

Template
────────
HTML body is rendered from helpdesk/templates/email/verify_email.html.
Edit that file to change the email layout without touching Python code.
"""

import logging

from django.conf import settings

from .email_utils import render_email, send_email_async

logger = logging.getLogger(__name__)

_SUBJECT = 'Verify your IIC IT Helpdesk account'


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
        return getattr(settings, 'VERIFICATION_FROM_EMAIL', 'noreply@iic.edu.np')


def _expiry_hours() -> int:
    try:
        from .email_config_service import get_verification_expiry_hours
        return get_verification_expiry_hours()
    except Exception:
        return int(getattr(settings, 'VERIFICATION_TOKEN_EXPIRY_HOURS', 24))


def _helpdesk_url() -> str:
    return getattr(settings, 'HELPDESK_URL', 'http://localhost:3000').rstrip('/')


# ── Public API ────────────────────────────────────────────────────────────────

def send_verification_email(user) -> None:
    """
    Generate a new EmailVerificationToken for *user* and dispatch the
    verification email in a daemon thread so the caller is never blocked.

    Uses django.core.mail.send_mail() routed through the effective
    MAILERS["default"] (DB-override or .env fallback).

    SECURITY:
      - The raw token is captured only inside the send_email_async closure.
      - It is NEVER logged, stored in any attribute, or returned.
      - Credentials come from the DB/env via settings.MAILERS, not from
        any argument to this function.
    """
    if not _verification_enabled():
        logger.debug('Email verification disabled. Skipping for user id=%s.', user.pk)
        return

    from .models import EmailVerificationToken

    expiry_hours = _expiry_hours()
    raw_token, _token_obj = EmailVerificationToken.create_for_user(user)

    verify_url = f'{_helpdesk_url()}/verify-email?token={raw_token}'
    name       = user.get_full_name() or user.username

    plain = (
        f'Hi {name},\n\n'
        f'Please verify your IIC IT Helpdesk account by visiting:\n\n'
        f'{verify_url}\n\n'
        f'This link expires in {expiry_hours} hour(s).\n\n'
        f'If you did not register for this service, you can safely ignore this email.\n\n'
        f'Do not share this link with anyone.\n\n'
        f'— IIC IT & NOC Department'
    )

    html = render_email('email/verify_email.html', {
        'name':         name,
        'email':        user.email,
        'verify_url':   verify_url,
        'expires_hours': expiry_hours,
    })

    send_email_async(
        subject    = _SUBJECT,
        plain      = plain,
        html       = html,
        to         = user.email,
        from_email = _from_email(),
        log_tag    = f'verify_email user_id={user.pk}',
    )


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
