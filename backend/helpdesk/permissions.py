"""
DRF permission classes for the IIC IT Helpdesk role system.

Roles (in descending priority):
    administrator > service_lead > designated_approver > content_editor
    > it_agent > it_noc_intern > faculty_staff > student > visitor

Usage:
    from helpdesk.permissions import IsAdministrator, IsContentEditor, ...

Deprecated alias:
    IsSuperuser = IsAdministrator  (kept for backward compatibility; remove in next breaking release)
"""

from django.conf import settings
from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.permissions import BasePermission

from helpdesk.models import RoleGrant


# ---------------------------------------------------------------------------
# Helper: resolve a user's currently active roles
# ---------------------------------------------------------------------------

def get_user_roles(user) -> frozenset:
    """
    Return the set of active role value strings for *user*.

    Returns ``frozenset()`` for unauthenticated / anonymous users or if the
    user has no active grants.
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return frozenset()
    return frozenset(
        RoleGrant.objects.active_for(user).values_list('role', flat=True)
    )


# ---------------------------------------------------------------------------
# Base permission class
# ---------------------------------------------------------------------------

class HasRole(BasePermission):
    """
    DRF permission class that checks the requesting user's active role grants.

    Subclasses declare ``allowed_roles`` as a set of role value strings.
    The request is allowed only when the user holds at least one of those roles.

    Raises:
        NotAuthenticated (→ HTTP 401) — if the request has no authenticated session.
        PermissionDenied  (→ HTTP 403) — if the user lacks all required roles.
    """

    # Override in subclasses:
    allowed_roles: set = set()

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            raise NotAuthenticated(
                detail='Authentication required.',
                code='not_authenticated',
            )

        user_roles = get_user_roles(request.user)

        if not user_roles.intersection(self.allowed_roles):
            sorted_roles = sorted(self.allowed_roles)
            raise PermissionDenied(
                detail=f'Requires one of: {sorted_roles}',
                code='permission_denied',
            )

        return True


# ---------------------------------------------------------------------------
# Named permission classes (Task 5.2)
# ---------------------------------------------------------------------------

class IsAdministrator(HasRole):
    """Requires the ``administrator`` role."""
    allowed_roles = {'administrator'}


class IsServiceLead(HasRole):
    """Requires ``service_lead`` or ``administrator``."""
    allowed_roles = {'service_lead', 'administrator'}


class IsITAgent(HasRole):
    """Requires ``it_agent``, ``it_noc_intern``, ``service_lead``, or ``administrator``."""
    allowed_roles = {'it_agent', 'it_noc_intern', 'service_lead', 'administrator'}


class IsContentEditor(HasRole):
    """Requires ``content_editor`` or ``administrator``."""
    allowed_roles = {'content_editor', 'administrator'}


class IsDesignatedApprover(HasRole):
    """Requires ``designated_approver`` or ``administrator``."""
    allowed_roles = {'designated_approver', 'administrator'}


class IsStaffUser(HasRole):
    """
    Requires any staff-level role:
    ``faculty_staff``, ``it_agent``, ``it_noc_intern``, ``service_lead``,
    ``designated_approver``, ``content_editor``, or ``administrator``.
    """
    allowed_roles = {
        'faculty_staff',
        'it_agent',
        'it_noc_intern',
        'service_lead',
        'designated_approver',
        'content_editor',
        'administrator',
    }


# Deprecated alias — kept for backward compatibility (Requirement 9.6).
# Do not use in new code; remove in the next breaking-change release.
IsSuperuser = IsAdministrator


# ---------------------------------------------------------------------------
# Intern scope helpers (Task 5.3)
# ---------------------------------------------------------------------------

#: Roles that override the intern category scope restriction.
INTERN_OVERRIDE_ROLES: frozenset = frozenset({'it_agent', 'service_lead', 'administrator'})


def user_has_intern_scope_only(user) -> bool:
    """
    Return ``True`` only when *user* holds ``it_noc_intern`` but does NOT hold
    any of the override roles (``it_agent``, ``service_lead``, ``administrator``).

    A user with both ``it_noc_intern`` and a more-permissive role is treated as
    having full access (Requirement 4.5).
    """
    roles = get_user_roles(user)
    return 'it_noc_intern' in roles and not roles.intersection(INTERN_OVERRIDE_ROLES)


def get_intern_scope_slugs() -> list:
    """
    Return the list of active ``ServiceCategory`` slugs permitted for IT-NOC Intern users.

    Reads from ``InternCategoryScope`` in the database.  If the table is empty
    (e.g., before the seed migration has run), falls back to
    ``settings.HELPDESK_INTERN_SCOPE_SLUGS``, and then to the hard-coded defaults.
    """
    # Local import to avoid circular imports at module load time.
    from helpdesk.models import InternCategoryScope  # noqa: PLC0415

    slugs = list(
        InternCategoryScope.objects.filter(is_active=True).values_list('slug', flat=True)
    )
    if not slugs:
        slugs = list(
            getattr(
                settings,
                'HELPDESK_INTERN_SCOPE_SLUGS',
                ['laptop-device-support', 'wifi-issue', 'general-it-support'],
            )
        )
    return slugs
