"""
helpdesk.email_config_service
══════════════════════════════
Single source of truth for the effective email configuration.

Django 6.1 compatibility
─────────────────────────
MAILERS is the ONLY email configuration mechanism. This module never
reads or writes any EMAIL_* setting — doing so would raise
ImproperlyConfigured on Django 6.1.

apply_mailers_override() updates settings.MAILERS["default"] in-process
so a change saved in Django Admin takes effect for subsequent requests
without a server restart.

Precedence
──────────
  1. Active EmailConfiguration row in the database
  2. MAILER_* env vars (via settings.MAILERS built in settings.py)
  3. Application defaults

Public API
──────────
  get_effective_mailer()          → dict  (MAILERS["default"] compatible)
  get_effective_from_email()      → str
  is_verification_enabled()       → bool
  get_verification_expiry_hours() → int
  apply_mailers_override()        → None  (updates settings.MAILERS live)
"""

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

_SMTP_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'


def _env_mailer_dict() -> dict:
    """
    Return the current settings.MAILERS["default"] as-is.
    This reflects the MAILER_* env-var configuration built at startup.
    """
    return dict(settings.MAILERS.get('default', {
        'BACKEND': 'django.core.mail.backends.console.EmailBackend',
        'OPTIONS': {},
    }))


def get_effective_mailer() -> dict:
    """
    Return the MAILERS["default"]-compatible dict for the active config.

    - Non-SMTP backends always receive OPTIONS: {} (never SMTP kwargs).
    - Falls back to env-var config when no active DB row exists.
    """
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(
            is_active=True
        ).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.to_mailer_dict()
    except Exception as exc:
        logger.debug(
            'get_effective_mailer: DB not available (%s), using env',
            type(exc).__name__,
        )
    return _env_mailer_dict()


def get_effective_from_email() -> str:
    """Return the From: address for outgoing emails."""
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(
            is_active=True
        ).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.from_email
    except Exception:
        pass
    return getattr(settings, 'VERIFICATION_FROM_EMAIL', 'noreply@iic.edu.np')


def is_verification_enabled() -> bool:
    """Return True if email verification is enabled."""
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(
            is_active=True
        ).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.verification_enabled
    except Exception:
        pass
    return getattr(settings, 'EMAIL_VERIFICATION_ENABLED', True)


def get_verification_expiry_hours() -> int:
    """Return the token expiry window in hours."""
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(
            is_active=True
        ).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.verification_token_expiry_hours
    except Exception:
        pass
    return int(getattr(settings, 'VERIFICATION_TOKEN_EXPIRY_HOURS', 24))


def apply_mailers_override() -> None:
    """
    Update settings.MAILERS["default"] with the currently effective
    configuration so subsequent send_mail() calls use the new backend
    without a server restart.

    Django 6.1: only MAILERS is modified — never EMAIL_* settings.
    Thread-safety: dict key assignment is safe under the GIL.
    """
    try:
        effective = get_effective_mailer()
        settings.MAILERS['default'] = effective
        logger.info(
            'MAILERS["default"] updated to backend=%s',
            effective.get('BACKEND', '?'),
        )
    except Exception as exc:
        logger.error('apply_mailers_override failed: %s', type(exc).__name__)
