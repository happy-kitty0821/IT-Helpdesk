"""
helpdesk.email_config_service
══════════════════════════════
Single source of truth for the effective email configuration.

Django version compatibility
─────────────────────────────
This project runs Django 5.2 which uses the standard EMAIL_BACKEND /
EMAIL_HOST / EMAIL_PORT / EMAIL_HOST_USER / EMAIL_HOST_PASSWORD /
EMAIL_USE_TLS / EMAIL_USE_SSL / EMAIL_TIMEOUT settings.

The MAILERS dict in settings.py is a project-level data structure used
by this service and the EmailConfiguration admin model — it is NOT read
by Django 5.2's mail machinery.

apply_mailers_override() updates BOTH settings.EMAIL_BACKEND and the
individual EMAIL_* settings so that subsequent send_mail() calls use the
correct backend and transport configuration without a server restart.

Precedence
──────────
  1. Active EmailConfiguration row in the database
  2. MAILER_* environment variables (via settings.EMAIL_BACKEND / EMAIL_*)
  3. Application defaults

Public API
──────────
  get_effective_mailer()          → dict  (MAILERS["default"] compatible)
  get_effective_from_email()      → str
  is_verification_enabled()       → bool
  get_verification_expiry_hours() → int
  apply_mailers_override()        → None  (updates settings.EMAIL_* live)
"""

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

_SMTP_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'


def _env_mailer_dict() -> dict:
    """Build a MAILERS-compatible dict from the current Django EMAIL_* settings."""
    backend = getattr(settings, 'EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
    if backend == _SMTP_BACKEND:
        opts: dict = {
            'host':    getattr(settings, 'EMAIL_HOST', 'localhost'),
            'port':    getattr(settings, 'EMAIL_PORT', 587),
            'use_tls': getattr(settings, 'EMAIL_USE_TLS', True),
            'use_ssl': getattr(settings, 'EMAIL_USE_SSL', False),
            'timeout': getattr(settings, 'EMAIL_TIMEOUT', 30),
        }
        username = getattr(settings, 'EMAIL_HOST_USER', '')
        password = getattr(settings, 'EMAIL_HOST_PASSWORD', '')
        if username:
            opts['username'] = username
        if password:
            opts['password'] = password
    else:
        opts = {}
    return {'BACKEND': backend, 'OPTIONS': opts}


def get_effective_mailer() -> dict:
    """
    Return the MAILERS["default"]-compatible dict for the currently active
    configuration.  DB row takes precedence; falls back to EMAIL_* settings.

    Non-SMTP backends always receive empty OPTIONS so the SMTP kwargs are
    never passed to console/dummy/locmem backends.
    """
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(is_active=True).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.to_mailer_dict()
    except Exception as exc:
        logger.debug('get_effective_mailer: DB not available (%s), using env', type(exc).__name__)

    return _env_mailer_dict()


def get_effective_from_email() -> str:
    """Return the From: address for outgoing emails."""
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(is_active=True).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.from_email
    except Exception:
        pass
    return getattr(settings, 'VERIFICATION_FROM_EMAIL', 'noreply@iic.edu.np')


def is_verification_enabled() -> bool:
    """Return True if email verification is enabled in the effective config."""
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(is_active=True).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.verification_enabled
    except Exception:
        pass
    return getattr(settings, 'EMAIL_VERIFICATION_ENABLED', True)


def get_verification_expiry_hours() -> int:
    """Return the token expiry window (hours) from the effective config."""
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(is_active=True).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.verification_token_expiry_hours
    except Exception:
        pass
    return int(getattr(settings, 'VERIFICATION_TOKEN_EXPIRY_HOURS', 24))


def apply_mailers_override() -> None:
    """
    Update the live Django EMAIL_* settings with the currently effective
    configuration so subsequent send_mail() calls use the right backend
    without a server restart.

    In Django 5.2, send_mail() reads settings.EMAIL_BACKEND (and the other
    EMAIL_* settings) directly, so we update all of them here.

    We also keep settings.MAILERS["default"] in sync for consistency with
    the EmailConfiguration.to_mailer_dict() format.

    Thread-safety: simple attribute assignment is safe under the GIL.
    """
    try:
        effective = get_effective_mailer()
        backend = effective.get('BACKEND', 'django.core.mail.backends.console.EmailBackend')
        opts    = effective.get('OPTIONS', {})

        # Update Django 5.2 settings that send_mail() actually reads
        settings.EMAIL_BACKEND       = backend
        settings.EMAIL_HOST          = opts.get('host',    getattr(settings, 'EMAIL_HOST', 'localhost'))
        settings.EMAIL_PORT          = opts.get('port',    getattr(settings, 'EMAIL_PORT', 587))
        settings.EMAIL_USE_TLS       = opts.get('use_tls', getattr(settings, 'EMAIL_USE_TLS', True))
        settings.EMAIL_USE_SSL       = opts.get('use_ssl', getattr(settings, 'EMAIL_USE_SSL', False))
        settings.EMAIL_HOST_USER     = opts.get('username', getattr(settings, 'EMAIL_HOST_USER', ''))
        settings.EMAIL_HOST_PASSWORD = opts.get('password', getattr(settings, 'EMAIL_HOST_PASSWORD', ''))
        settings.EMAIL_TIMEOUT       = opts.get('timeout',  getattr(settings, 'EMAIL_TIMEOUT', 30))

        # Also keep the MAILERS dict in sync for our own service lookups
        settings.MAILERS['default'] = effective

        logger.info('Email settings updated to backend=%s', backend)
    except Exception as exc:
        logger.error('apply_mailers_override failed: %s', type(exc).__name__)
