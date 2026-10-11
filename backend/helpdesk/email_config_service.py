"""
helpdesk.email_config_service
══════════════════════════════
Unified transport resolution for all outgoing emails.

Transport precedence (highest → lowest)
────────────────────────────────────────
1. Active NotificationChannel of type email_smtp or email_mailgun that has
   a rule matching the requested event_type (admin configures per-event
   channel overrides in Admin → Notifications).
2. Active EmailConfiguration DB row (global SMTP override set by admin).
3. settings.MAILERS["default"] built from MAILER_* env vars at startup.

This means admins can:
  • Route ticket-event emails through a dedicated Mailgun account
  • Route verification emails through a different SMTP server
  • Fall back to the .env SMTP with zero DB config needed
  • Switch transport at runtime without a restart (except env-only fallback)

Public API
──────────
  resolve_transport(event_type)   → dict  (transport descriptor)
  get_effective_from_email()      → str
  is_verification_enabled()       → bool
  get_verification_expiry_hours() → int
  apply_mailers_override()        → None  (hot-reload settings.MAILERS)
"""

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

_SMTP_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'

# ── Transport descriptor shape ────────────────────────────────────────────────
#
# Every resolve_transport() result is a dict with at least:
#   {
#       'source':     'channel' | 'db_config' | 'env',
#       'backend':    'smtp' | 'mailgun' | 'django_mailer',
#       'config':     dict,          # backend-specific credentials
#       'from_email': str,
#   }


def _env_transport() -> dict:
    """Build a transport descriptor from the current settings.MAILERS."""
    mailer = dict(settings.MAILERS.get('default', {
        'BACKEND': 'django.core.mail.backends.console.EmailBackend',
        'OPTIONS': {},
    }))
    opts = mailer.get('OPTIONS', {})
    return {
        'source':     'env',
        'backend':    'django_mailer',
        'config':     opts,
        'from_email': getattr(settings, 'VERIFICATION_FROM_EMAIL', 'noreply@iic.edu.np'),
    }


def _db_config_transport() -> dict | None:
    """Return a transport descriptor from the EmailConfiguration DB row, or None."""
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(
            is_active=True
        ).order_by('-updated_at').first()
        if cfg is None:
            return None
        mailer = cfg.to_mailer_dict()
        return {
            'source':     'db_config',
            'backend':    'django_mailer',
            'config':     mailer.get('OPTIONS', {}),
            'from_email': cfg.from_email,
            '_mailer':    mailer,   # passed to apply_mailers_override internally
        }
    except Exception as exc:
        logger.debug('_db_config_transport: DB unavailable (%s)', type(exc).__name__)
        return None


def _channel_transport(event_type: str) -> dict | None:
    """
    Return a transport descriptor from an active NotificationChannel that has
    a rule for *event_type*, or None.

    Preference: email_smtp before email_mailgun (more standard).
    """
    try:
        from .models import NotificationChannel, NotificationRule
        rule = (
            NotificationRule.objects
            .filter(event_type=event_type, is_active=True)
            .filter(channel__type__in=('email_smtp', 'email_mailgun'),
                    channel__is_active=True)
            .select_related('channel')
            .order_by(
                # smtp first, mailgun second
                'channel__type'
            )
            .first()
        )
        if rule is None:
            return None
        ch = rule.channel
        return {
            'source':     'channel',
            'backend':    'smtp' if ch.type == 'email_smtp' else 'mailgun',
            'config':     ch.config,
            'from_email': ch.config.get('from_email', ''),
            'channel':    ch,
        }
    except Exception as exc:
        logger.debug('_channel_transport: DB unavailable (%s)', type(exc).__name__)
        return None


def resolve_transport(event_type: str = '') -> dict:
    """
    Return the highest-priority available transport for *event_type*.

    Falls through the precedence chain until something works.
    Always returns a valid descriptor (env is the guaranteed fallback).
    """
    # 1. Channel override for this specific event
    if event_type:
        t = _channel_transport(event_type)
        if t:
            logger.debug('resolve_transport[%s]: using channel %s', event_type, t.get('channel'))
            return t

    # 2. Global DB config
    t = _db_config_transport()
    if t:
        logger.debug('resolve_transport[%s]: using DB EmailConfiguration', event_type)
        return t

    # 3. .env fallback (always available)
    logger.debug('resolve_transport[%s]: using env MAILERS', event_type)
    return _env_transport()


# ── Convenience accessors (used by legacy callers) ────────────────────────────

def get_effective_from_email() -> str:
    """Return the From: address for the globally-configured mailer."""
    t = _db_config_transport()
    if t:
        return t['from_email']
    return getattr(settings, 'VERIFICATION_FROM_EMAIL', 'noreply@iic.edu.np')


def is_verification_enabled() -> bool:
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(is_active=True).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.verification_enabled
    except Exception:
        pass
    return getattr(settings, 'EMAIL_VERIFICATION_ENABLED', True)


def get_verification_expiry_hours() -> int:
    try:
        from .models import EmailConfiguration
        cfg = EmailConfiguration.objects.filter(is_active=True).order_by('-updated_at').first()
        if cfg is not None:
            return cfg.verification_token_expiry_hours
    except Exception:
        pass
    return int(getattr(settings, 'VERIFICATION_TOKEN_EXPIRY_HOURS', 24))


def apply_mailers_override() -> None:
    """Hot-reload settings.MAILERS["default"] from the active DB config."""
    try:
        t = _db_config_transport()
        if t and '_mailer' in t:
            settings.MAILERS['default'] = t['_mailer']
            logger.info(
                'MAILERS["default"] updated to backend=%s',
                t['_mailer'].get('BACKEND', '?'),
            )
    except Exception as exc:
        logger.error('apply_mailers_override failed: %s', type(exc).__name__)
