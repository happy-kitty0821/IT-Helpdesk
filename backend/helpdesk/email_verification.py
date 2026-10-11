"""
helpdesk.email_verification
═══════════════════════════
Email ownership verification — token generation and dispatch.

All email sending now routes through email_dispatch.resolve_and_send(),
which respects the unified transport + template precedence chain:
  1. DB EmailTemplate override (admin-editable in Admin → Notifications)
  2. On-disk fallback (helpdesk/templates/email/email_verification.html)

  Transport:
  1. NotificationChannel with a rule for 'email_verification'
  2. Active EmailConfiguration DB row
  3. MAILER_* env vars

Token security
──────────────
- Raw token (32 random bytes, 64-char hex) is NEVER stored.
- Only the SHA-256 digest is persisted.
- The raw token lives only inside the email body — never logged or returned.
"""

import logging

from django.conf import settings


logger = logging.getLogger(__name__)


def _verification_enabled() -> bool:
    try:
        from .email_config_service import is_verification_enabled
        return is_verification_enabled()
    except Exception:
        return getattr(settings, 'EMAIL_VERIFICATION_ENABLED', True)


def _expiry_hours() -> int:
    try:
        from .email_config_service import get_verification_expiry_hours
        return get_verification_expiry_hours()
    except Exception:
        return int(getattr(settings, 'VERIFICATION_TOKEN_EXPIRY_HOURS', 24))


def _helpdesk_url() -> str:
    return getattr(settings, 'HELPDESK_URL', 'http://localhost:3000').rstrip('/')


def _support_email() -> str:
    try:
        from .signals import get_support_email
        return get_support_email()
    except Exception:
        return 'support@iic.edu.np'


# ── Public API ────────────────────────────────────────────────────────────────

def send_verification_email(user) -> None:
    """
    Generate a new EmailVerificationToken for *user* and dispatch the
    verification email through the unified email dispatcher.
    """
    if not _verification_enabled():
        logger.debug('Email verification disabled — skipping for user id=%s.', user.pk)
        return

    from .models import EmailVerificationToken
    from .email_dispatch import resolve_and_send

    expiry_hours = _expiry_hours()
    raw_token, _token_obj = EmailVerificationToken.create_for_user(user)

    verify_url = f'{_helpdesk_url()}/verify-email?token={raw_token}'
    name       = user.get_full_name() or user.username

    resolve_and_send(
        event_type = 'email_verification',
        context    = {
            'name':          name,
            'email':         user.email,
            'verify_url':    verify_url,
            'expires_hours': expiry_hours,
            'support_email': _support_email(),
            'helpdesk_url':  _helpdesk_url(),
        },
        to_email   = user.email,
        subject    = 'Verify your IIC IT Helpdesk account',
        log_tag    = f'verify_email user_id={user.pk}',
    )


def verify_token_and_activate(raw_token: str) -> object:
    """
    Validate *raw_token*, mark it used, and activate the user.
    Returns the User instance on success; raises ValueError on any failure.
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
