"""
helpdesk.throttling
═══════════════════
Admin-configurable rate-limiting engine.

How it works
────────────
1.  Each view (or mixin) declares a throttle scope string, e.g. "ticket_create".
2.  On every request, ``DatabaseScopedThrottle.allow_request()`` looks up the
    active ``RateLimitRule`` for that scope from a short-lived Django cache
    (TTL = 60 s) to avoid a DB hit on every request.
3.  The cache key is just the DRF rate string returned by ``get_rate()``,
    which DRF's ``SimpleRateThrottle`` base class uses to build the counter key.
4.  When the limit is exceeded:
        block    → return 429 (DRF's default)
        warn     → allow the request but write a RateLimitViolation record
        suspend  → suspend the account (sets is_active=False + UserProfile flag)
                   then return 403 with a suspension-style response
5.  Violations are written asynchronously in a background thread so they never
    add latency to the hot path.

Fallback behaviour
──────────────────
If no active rule exists for a scope the throttle transparently allows the
request (no-op). This means new scopes can be deployed and configured later
without breaking anything.
"""

import logging
import threading
from typing import Optional

from django.core.cache import cache
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.exceptions import Throttled
from rest_framework.request import Request

logger = logging.getLogger(__name__)

# Cache TTL for rule lookups (seconds). Keeps DB queries minimal.
_RULE_CACHE_TTL = 60


def _get_rule(scope: str) -> Optional[object]:
    """
    Return the active RateLimitRule for *scope* from cache, falling back to DB.
    Returns None if no active rule is configured for this scope.
    """
    cache_key = f'rl_rule:{scope}'
    rule = cache.get(cache_key, default=...)  # use sentinel to distinguish None
    if rule is ...:
        from .models import RateLimitRule
        try:
            rule = RateLimitRule.objects.get(scope=scope, is_active=True)
        except RateLimitRule.DoesNotExist:
            rule = None
        cache.set(cache_key, rule, timeout=_RULE_CACHE_TTL)
    return rule


def _invalidate_rule_cache(scope: str) -> None:
    """Call this after saving a RateLimitRule to flush the cache."""
    cache.delete(f'rl_rule:{scope}')


def _log_violation(rule, identifier: str, request: Request, request_count: int, action_taken: str) -> None:
    """Write a RateLimitViolation record in a daemon thread."""
    def _write():
        try:
            from .models import RateLimitViolation
            user = request.user if request.user and request.user.is_authenticated else None
            RateLimitViolation.objects.create(
                rule=rule,
                identifier=identifier,
                user=user,
                request_count=request_count,
                action_taken=action_taken,
                request_path=getattr(request, 'path', '')[:500],
                request_method=getattr(request, 'method', '')[:10],
                user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:512],
                ip_address=_get_client_ip(request),
            )
        except Exception as exc:
            logger.warning('Failed to write RateLimitViolation: %s', exc)

    t = threading.Thread(target=_write, daemon=True)
    t.start()


def _get_client_ip(request: Request) -> Optional[str]:
    """Extract the real client IP, honouring X-Forwarded-For."""
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def _suspend_user(request: Request, rule, identifier: str, request_count: int) -> None:
    """
    Suspend the authenticated user account and log the violation.
    Runs in a background thread to keep the response fast.
    """
    def _do_suspend():
        try:
            if not (request.user and request.user.is_authenticated):
                return
            from django.contrib.auth import get_user_model
            from .models import UserProfile
            from django.db import transaction
            User = get_user_model()
            with transaction.atomic():
                profile, _ = UserProfile.objects.get_or_create(user=request.user)
                profile.is_suspended = True
                profile.suspension_reason = (
                    f'Account automatically suspended: exceeded rate limit for '
                    f'"{rule.scope}" ({rule.limit}/{rule.window}).'
                )
                profile.save(update_fields=['is_suspended', 'suspension_reason'])
                User.objects.filter(pk=request.user.pk).update(is_active=False)
            _log_violation(rule, identifier, request, request_count, 'suspended')
        except Exception as exc:
            logger.warning('Failed to auto-suspend user: %s', exc)

    t = threading.Thread(target=_do_suspend, daemon=True)
    t.start()


class DatabaseScopedThrottle(SimpleRateThrottle):
    """
    DRF throttle class that reads its rate from the database.

    Usage — set on a view or mixin:

        class MyView(APIView):
            throttle_classes = (DatabaseScopedThrottle,)
            throttle_scope   = 'ticket_create'

    The throttle is a no-op if no active RateLimitRule exists for the scope.
    """

    # DRF calls get_rate() once during __init__; we override allow_request()
    # to do the real work so we always use the freshest cached rule.
    scope: str = ''

    def get_rate(self) -> Optional[str]:
        """Return a DRF rate string or None (disables counting)."""
        if not self.scope:
            return None
        rule = _get_rule(self.scope)
        if rule is None:
            return None
        return f'{rule.limit}/{rule.window}'

    # ── Cache key ─────────────────────────────────────────────────────────────

    def get_cache_key(self, request: Request, view) -> Optional[str]:
        rule = _get_rule(self.scope)
        if rule is None:
            return None  # no rule → no throttling

        if request.user and request.user.is_authenticated:
            ident = f'user:{request.user.pk}'
        else:
            ident = self.get_ident(request)  # IP-based

        return f'throttle:{self.scope}:{ident}'

    # ── Core decision ─────────────────────────────────────────────────────────

    def allow_request(self, request: Request, view) -> bool:
        rule = _get_rule(self.scope)
        if rule is None:
            return True  # no active rule → always allow

        # Re-read the rate from the live rule (in case cache was just flushed)
        self.rate = f'{rule.limit}/{rule.window}'
        self.num_requests, self.duration = self.parse_rate(self.rate)

        allowed = super().allow_request(request, view)

        if not allowed:
            # Determine the identifier used in the cache key
            if request.user and request.user.is_authenticated:
                identifier = f'user:{request.user.pk}'
            else:
                identifier = self.get_ident(request)

            # How many requests have accumulated?
            history = self.cache.get(self.get_cache_key(request, view), [])
            request_count = len(history) + 1

            # Has the violation_threshold been exceeded?
            excess = request_count - self.num_requests
            if excess > rule.violation_threshold:
                action = rule.violation_action

                if action == 'suspend' and request.user and request.user.is_authenticated:
                    _suspend_user(request, rule, identifier, request_count)
                    # Return False — DRF will raise Throttled (429)
                    # but caller can convert to 403 if desired
                    return False

                if action == 'warn':
                    _log_violation(rule, identifier, request, request_count, 'warned')
                    return True  # warn but allow through

                # block (default)
                _log_violation(rule, identifier, request, request_count, 'blocked')
                return False

            # Excess is within violation_threshold — log nothing, just block
            return False

        return True

    def throttle_failure_message(self, rule) -> str:
        return (
            f'Rate limit exceeded for {self.scope}. '
            f'Maximum {rule.limit} requests per {rule.window}.'
        )


# ── Convenience subclasses ───────────────────────────────────────────────────
# One class per scope so views can list them by class (DRF instantiates
# throttle_classes as instances, so each class must have its scope baked in).

class AuthLoginThrottle(DatabaseScopedThrottle):
    scope = 'auth_login'

class AuthRegisterThrottle(DatabaseScopedThrottle):
    scope = 'auth_register'

class AuthGoogleThrottle(DatabaseScopedThrottle):
    scope = 'auth_google'

class TicketCreateThrottle(DatabaseScopedThrottle):
    scope = 'ticket_create'

class TicketMessageThrottle(DatabaseScopedThrottle):
    scope = 'ticket_message'

class TicketStatusThrottle(DatabaseScopedThrottle):
    scope = 'ticket_status'

class PublicApiThrottle(DatabaseScopedThrottle):
    scope = 'public_api'

class AdminUserWriteThrottle(DatabaseScopedThrottle):
    scope = 'admin_user_write'

class AdminBulkThrottle(DatabaseScopedThrottle):
    scope = 'admin_bulk'

class ExportThrottle(DatabaseScopedThrottle):
    scope = 'export'

class ChangePasswordThrottle(DatabaseScopedThrottle):
    scope = 'change_password'


# ── Seed helper ──────────────────────────────────────────────────────────────

DEFAULT_RULES = [
    # scope              label                                     limit  window   action  threshold
    ('auth_login',       'Login attempts',                         10,    'minute', 'block',   0),
    ('auth_register',    'Registration attempts',                   5,    'hour',   'block',   0),
    ('auth_google',      'Google SSO attempts',                    10,    'minute', 'block',   0),
    ('ticket_create',    'Ticket submissions per user',            20,    'hour',   'block',   0),
    ('ticket_message',   'Ticket replies per user',                60,    'hour',   'warn',    5),
    ('ticket_status',    'Ticket status changes',                  30,    'hour',   'block',   0),
    ('public_api',       'Public API read requests (per IP)',     120,    'minute', 'block',   0),
    ('admin_user_write', 'Admin user management writes',           60,    'hour',   'block',   0),
    ('admin_bulk',       'Admin bulk / write operations',         120,    'hour',   'warn',   10),
    ('export',           'Ticket export downloads',                 5,    'hour',   'block',   0),
    ('change_password',  'Password change attempts',                5,    'hour',   'block',   0),
]

SCOPE_DESCRIPTIONS = {
    'auth_login':       'Limits failed and successful login attempts per IP/user to mitigate brute-force attacks.',
    'auth_register':    'Limits account creation per IP to prevent registration spam.',
    'auth_google':      'Limits Google SSO sign-in attempts per IP.',
    'ticket_create':    'Limits how many new support tickets a user can open per hour.',
    'ticket_message':   'Limits how many replies a user can post on tickets per hour.',
    'ticket_status':    'Limits how many status transitions (cancel, close) a user can perform per hour.',
    'public_api':       'Global read-rate cap for unauthenticated/public API calls per IP.',
    'admin_user_write': 'Limits write operations on user accounts (create, patch, suspend, delete) per admin.',
    'admin_bulk':       'Limits write operations across all other admin endpoints per staff user.',
    'export':           'Limits how many Excel ticket exports can be downloaded per user per hour.',
    'change_password':  'Limits password change attempts per authenticated user per hour to prevent brute-force attacks against the current password.',
}


def seed_default_rules() -> None:
    """
    Idempotently create RateLimitRule rows for each default scope.
    Called from a management command or signal — never overwrites existing rows.
    """
    from .models import RateLimitRule
    for scope, label, limit, window, action, threshold in DEFAULT_RULES:
        RateLimitRule.objects.get_or_create(
            scope=scope,
            defaults={
                'label':               label,
                'description':         SCOPE_DESCRIPTIONS.get(scope, ''),
                'limit':               limit,
                'window':              window,
                'violation_action':    action,
                'violation_threshold': threshold,
                'is_active':           True,
            },
        )


# ── Custom DRF exception handler ─────────────────────────────────────────────

def _format_wait(seconds: int) -> str:
    """Convert a wait time in seconds to a human-readable string."""
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    hours = minutes // 60
    remaining_minutes = minutes % 60
    if remaining_minutes == 0:
        return f"{hours} hour{'s' if hours != 1 else ''}"
    return f"{hours} hour{'s' if hours != 1 else ''} and {remaining_minutes} minute{'s' if remaining_minutes != 1 else ''}"


def custom_exception_handler(exc, context):
    """
    DRF exception handler that replaces the default machine-readable
    throttle message ("Request was throttled. Expected available in N seconds.")
    with a clear, user-friendly explanation.

    Register in settings.py under REST_FRAMEWORK:
        'EXCEPTION_HANDLER': 'helpdesk.throttling.custom_exception_handler'
    """
    from rest_framework.views import exception_handler
    from rest_framework.exceptions import Throttled
    from rest_framework.response import Response
    from rest_framework import status

    response = exception_handler(exc, context)

    if isinstance(exc, Throttled):
        wait = exc.wait  # float | None — seconds until the window resets
        if wait is not None:
            wait_secs = max(1, int(wait))
            wait_str = _format_wait(wait_secs)
            detail = (
                f"You've made too many requests. "
                f"Please wait {wait_str} before trying again."
            )
        else:
            detail = (
                "You've made too many requests. "
                "Please wait a moment before trying again."
            )
        return Response(
            {"detail": detail, "code": "throttled"},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    return response
