from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.utils.text import slugify
from django.views import View
from django.views.decorators.csrf import csrf_protect
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from rest_framework import generics, permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from rest_framework.throttling import ScopedRateThrottle  # kept for fallback
from .throttling import (
    AuthLoginThrottle, AuthRegisterThrottle, AuthGoogleThrottle,
    TicketCreateThrottle, TicketMessageThrottle, TicketStatusThrottle,
    PublicApiThrottle, AdminUserWriteThrottle, AdminBulkThrottle, ExportThrottle,
    ChangePasswordThrottle,
)
from rest_framework.views import APIView

from .models import AccountRecoveryToken, Announcement, EmailTemplate, GuideArticle, NotificationChannel, NotificationLog, NotificationRule, RoleConfig, ServiceCategory, SiteSettings, SoftwareResource, Ticket, TicketAttachment, TicketFormSettings, TicketMessage
from .permissions import IsAdministrator, IsContentEditor, IsITAgent, IsServiceLead
from .serializers import (
    AnnouncementAdminSerializer,
    AnnouncementSerializer,
    AccountRecoveryTokenSerializer,
    AdminServiceCategorySerializer,
    EmailTemplateSerializer,
    GoogleCredentialSerializer,
    RoleConfigSerializer,
    SiteSettingsSerializer,
    TicketFormSettingsSerializer,
    LoginSerializer,
    NotificationChannelSerializer,
    NotificationLogSerializer,
    NotificationRuleSerializer,
    RegistrationSerializer,
    RoleGrantSerializer,
    ServiceCategorySerializer,
    SoftwareResourceSerializer,
    TicketAttachmentSerializer,
    TicketMessageSerializer,
    TicketSerializer,
    UserSerializer,
    AdminUserSerializer,
    GuideArticleSerializer,
    email_domain_allowed,
)


def health(request):
    return JsonResponse({'status': 'ok', 'service': 'iic-helpdesk-api'})


# ---------------------------------------------------------------------------
# Audience filtering utility (Requirement 3.1, 3.2)
# ---------------------------------------------------------------------------

# Audience values permitted for each role level
_AUDIENCE_MAP = {
    'administrator': {'public', 'student', 'staff', 'all'},
    'service_lead': {'public', 'student', 'staff', 'all'},
    'content_editor': {'public', 'student', 'staff', 'all'},
    'designated_approver': {'public', 'student', 'staff', 'all'},
    'it_agent': {'public', 'student', 'staff', 'all'},
    'it_noc_intern': {'public', 'student', 'staff', 'all'},
    'faculty_staff': {'public', 'student', 'staff', 'all'},
    'student': {'public', 'student', 'all'},
    'visitor': {'public', 'all'},
}

_ROLE_PRIORITY = [
    'administrator', 'service_lead', 'designated_approver', 'content_editor',
    'it_agent', 'it_noc_intern', 'faculty_staff', 'student', 'visitor',
]


def get_permitted_audiences(request) -> set:
    """Return the set of audience values the requesting user may access."""
    if not request.user or not request.user.is_authenticated:
        return {'public', 'all'}
    from .permissions import get_user_roles
    roles = get_user_roles(request.user)
    for role in _ROLE_PRIORITY:
        if role in roles:
            return _AUDIENCE_MAP[role]
    return {'public'}


class CsrfView(APIView):
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)

    def get(self, request):
        return Response({'csrfToken': get_token(request)})


class CurrentUserView(APIView):
    permission_classes = (permissions.AllowAny,)

    def get(self, request):
        if not request.user or not request.user.is_authenticated:
            return Response({'roles': ['visitor'], 'category_scope': None})
        return Response(UserSerializer(request.user).data)


@method_decorator(csrf_protect, name='dispatch')
class RegisterView(APIView):
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (AuthRegisterThrottle,)

    @transaction.atomic
    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # create_user() fires post_save which sets is_active=False
        # and dispatches the verification email in a background thread.
        serializer.save()
        # DO NOT call login() here — account is inactive until email is verified.
        return Response(
            {
                'detail': (
                    'Registration successful. A verification email has been sent '
                    'to your @iic.edu.np address. Please click the link to '
                    'activate your account.'
                ),
                'code': 'email_verification_required',
            },
            status=status.HTTP_202_ACCEPTED,
        )


@method_decorator(csrf_protect, name='dispatch')
class LoginView(APIView):
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (AuthLoginThrottle,)

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifier = serializer.validated_data['identifier']
        password   = serializer.validated_data['password']

        # Pre-check: look up the user by email or username to give a
        # suspension-specific error before Django's generic 'inactive' rejection.
        User = get_user_model()
        try:
            if '@' in identifier:
                candidate = User.objects.get(email__iexact=identifier)
            else:
                candidate = User.objects.get(username__iexact=identifier)
        except User.DoesNotExist:
            candidate = None

        if candidate is not None and not candidate.is_active:
            # Distinguish three inactive states:
            #   1. Email not yet verified (email_verified=False, is_suspended=False)
            #   2. Account suspended by administrator
            #   3. Generic admin-deactivated account
            try:
                profile = candidate.profile
                if profile.is_suspended:
                    reason = profile.suspension_reason or ''
                    return Response(
                        {
                            'code': 'account_suspended',
                            'detail': 'Your account has been suspended.',
                            'suspension_reason': reason,
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if not profile.email_verified:
                    return Response(
                        {
                            'code': 'email_not_verified',
                            'detail': (
                                'Your email address has not been verified. '
                                'Please check your inbox for the verification '
                                'link, or request a new one.'
                            ),
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )
            except Exception:
                pass
            return Response(
                {'detail': 'This account is inactive. Contact IT support.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        user = authenticate(request, username=identifier, password=password)
        if user is None:
            return Response({'detail': 'Invalid username/email or password.'}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response(UserSerializer(user).data)

class LogoutView(APIView):
    # Allow unauthenticated requests — logging out an already-logged-out
    # session is a safe no-op and should not return 401.
    permission_classes = (permissions.AllowAny,)

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name='dispatch')
class GoogleLoginView(APIView):
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (AuthGoogleThrottle,)

    @transaction.atomic
    def post(self, request):
        if not settings.GOOGLE_OAUTH_CLIENT_ID:
            return Response({'detail': 'Google sign-in is not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        serializer = GoogleCredentialSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            identity = id_token.verify_oauth2_token(
                serializer.validated_data['credential'],
                google_requests.Request(),
                settings.GOOGLE_OAUTH_CLIENT_ID,
            )
        except ValueError:
            return Response({'detail': 'Google sign-in could not be verified.'}, status=status.HTTP_400_BAD_REQUEST)

        email = identity.get('email', '').lower()
        hosted_domain = identity.get('hd', '').lower()
        if not identity.get('email_verified') or not email_domain_allowed(email):
            return Response({'detail': 'Use an approved IIC Google account.'}, status=status.HTTP_403_FORBIDDEN)
        if hosted_domain not in settings.ALLOWED_REGISTRATION_DOMAINS:
            return Response({'detail': 'This Google Workspace domain is not approved.'}, status=status.HTTP_403_FORBIDDEN)

        User = get_user_model()
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            base = slugify(email.split('@', 1)[0]).replace('-', '.') or 'iic.user'
            username = base
            suffix = 1
            while User.objects.filter(username__iexact=username).exists():
                suffix += 1
                username = f'{base}.{suffix}'
            # Mark the instance so the post_save signal knows Google already
            # verified ownership and should NOT set is_active=False.
            new_user = User(
                username=username, email=email,
                first_name=identity.get('given_name', '')[:150],
                last_name=identity.get('family_name', '')[:150],
            )
            new_user.set_unusable_password()
            new_user._email_verified_by_google = True  # read by post_save signal
            new_user.save()
            user = new_user
            # Persist Google profile picture for newly created users.
            # The post_save signal already created the UserProfile row.
            picture = identity.get('picture', '')[:500]
            if picture:
                from .models import UserProfile
                UserProfile.objects.filter(user=user).update(avatar_url=picture)

        # For existing inactive users: if they registered via password and never
        # verified, but now log in with Google (same email), treat Google's
        # identity.email_verified=True as proof of ownership and activate them.
        if not user.is_active:
            try:
                profile = user.profile
                if profile.is_suspended:
                    return Response(
                        {'code': 'account_suspended',
                         'detail': 'Your account has been suspended.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if not profile.email_verified:
                    from django.utils import timezone as _tz
                    with transaction.atomic():
                        user.is_active = True
                        user.save(update_fields=['is_active'])
                        profile.email_verified    = True
                        profile.email_verified_at = _tz.now()
                        profile.save(update_fields=['email_verified', 'email_verified_at'])
            except Exception:
                return Response(
                    {'detail': 'This account is inactive. Contact IT support.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if not user.is_active:
            return Response(
                {'detail': 'This account is inactive. Contact IT support.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Keep avatar_url fresh for returning Google users — Google can rotate
        # the picture URL, so update it on every successful sign-in.
        picture = identity.get('picture', '')[:500]
        if picture:
            from .models import UserProfile
            UserProfile.objects.filter(user=user).update(avatar_url=picture)

        login(request, user, backend='helpdesk.authentication.EmailOrUsernameBackend')
        return Response(UserSerializer(user).data)


class ServiceCategoryList(generics.ListAPIView):
    throttle_classes = (PublicApiThrottle,)
    permission_classes = (permissions.AllowAny,)
    pagination_class = None
    serializer_class = ServiceCategorySerializer

    def get_queryset(self):
        return ServiceCategory.objects.filter(
            audience__in=get_permitted_audiences(self.request),
            is_active=True,
        )


class TicketListCreate(generics.ListCreateAPIView):
    throttle_classes = (TicketCreateThrottle,)
    serializer_class = TicketSerializer

    def get_parsers(self):
        """Accept both JSON and multipart (for file-upload tickets)."""
        from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
        return [JSONParser(), MultiPartParser(), FormParser()]

    def get_serializer(self, *args, **kwargs):
        """
        When the request is multipart (files present), extra_fields arrives as
        a JSON string in the form-data body. Parse it before passing to the serializer.
        Only applied when `data` is explicitly passed (i.e. on POST/create, not on GET/list).
        """
        import json as _json
        from django.http import QueryDict

        # Only intervene when the caller actually passes `data` (create path).
        # On the list path, `data` is never in kwargs — leave it alone.
        if 'data' in kwargs:
            data = kwargs['data']
            if isinstance(data, QueryDict):
                # Multipart/form-data: convert to plain dict and parse
                # extra_fields from its JSON string representation.
                data = data.dict()
                if 'extra_fields' in data and isinstance(data['extra_fields'], str):
                    try:
                        data['extra_fields'] = _json.loads(data['extra_fields'])
                    except (ValueError, TypeError):
                        data['extra_fields'] = {}
                kwargs['data'] = data

        return super().get_serializer(*args, **kwargs)

    def get_queryset(self):
        from .permissions import get_user_roles, user_has_intern_scope_only, get_intern_scope_slugs
        user = self.request.user
        roles = get_user_roles(user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        # Superusers always see all tickets even if they have no explicit RoleGrant
        is_staff = user.is_superuser or bool(roles.intersection(staff_roles))
        if is_staff:
            # Staff see all tickets (intern scope filtering restricts by category)
            qs = Ticket.objects.select_related('category', 'requester', 'assigned_to')
            if not user.is_superuser and user_has_intern_scope_only(user):
                qs = qs.filter(category__slug__in=get_intern_scope_slugs())
        else:
            # Regular users see only their own tickets
            qs = Ticket.objects.filter(requester=user).select_related('category', 'assigned_to')

        # ── Search filter (?q=) — searches subject, reference, description, category name ──
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(subject__icontains=q) |
                Q(reference__icontains=q) |
                Q(description__icontains=q) |
                Q(category__name__icontains=q)
            )

        # ── Status filter (?status=submitted,resolved) — comma-separated list ──
        status_param = self.request.query_params.get('status', '').strip()
        if status_param:
            status_list = [s.strip() for s in status_param.split(',') if s.strip()]
            if status_list:
                qs = qs.filter(status__in=status_list)

        # ── Priority filter (?priority=p1,p2) — comma-separated list ──
        priority_param = self.request.query_params.get('priority', '').strip()
        if priority_param:
            priority_list = [p.strip() for p in priority_param.split(',') if p.strip()]
            if priority_list:
                qs = qs.filter(priority__in=priority_list)

        # ── Category filter (?category=wifi-issue) — slug-based ──
        category_param = self.request.query_params.get('category', '').strip()
        if category_param:
            cat_list = [c.strip() for c in category_param.split(',') if c.strip()]
            if cat_list:
                qs = qs.filter(category__slug__in=cat_list)

        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # Pass uploaded file keys so validate() can check required file fields
        ctx['file_keys'] = set(self.request.FILES.keys())
        return ctx

    def perform_create(self, serializer):
        category = serializer.validated_data.get('category')
        if category:
            permitted = get_permitted_audiences(self.request)
            if category.audience not in permitted:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied(
                    detail='Your role is not eligible for this service category.',
                    code='audience_not_eligible',
                )

        # If the admin has hidden the subject field, auto-generate it from the
        # category name so the ticket always has a meaningful subject.
        from .models import TicketFormSettings
        fs = TicketFormSettings.get()
        subject = serializer.validated_data.get('subject', '').strip()
        if not subject:
            if not fs.subject_visible or not fs.subject_required:
                # Build a sensible default: "College account recovery request" etc.
                auto_subject = (
                    f'{category.name} request' if category else 'Support request'
                )
                serializer.validated_data['subject'] = auto_subject
            # If subject IS required + visible but still blank, validate_subject
            # will have already raised an error before reaching here.

        # Auto-set current_stage to the first stage key if the category has stages defined.
        first_stage = ''
        if category and isinstance(category.stages, list) and category.stages:
            first_stage = category.stages[0].get('key', '')
        ticket = serializer.save(requester=self.request.user, current_stage=first_stage)

        # Save any uploaded file attachments (file-type schema fields)
        from .models import TicketAttachment
        for field_key, uploaded_file in self.request.FILES.items():
            # Validate content type
            allowed = TicketAttachment.ALLOWED_CONTENT_TYPES
            if uploaded_file.content_type not in allowed:
                continue  # silently skip disallowed types (front-end should prevent this)
            if uploaded_file.size > TicketAttachment.MAX_UPLOAD_BYTES:
                continue  # silently skip oversized files
            TicketAttachment.objects.create(
                ticket=ticket,
                field_key=field_key,
                file=uploaded_file,
                original_name=uploaded_file.name,
                content_type=uploaded_file.content_type,
                file_size=uploaded_file.size,
                uploaded_by=self.request.user,
            )


# ── Ticket status state machine ───────────────────────────────────────────────
#
# Defines the legal forward transitions for staff.  Terminal states (closed,
# cancelled) have no outgoing edges — they are intentionally absent as keys.
# "resolved" allows → in_progress so a ticket can be re-opened if the fix
# didn't hold.
#
# Interns get a narrower slice: they can only move to resolved (not close,
# not cancel) since closing/cancelling is a service-lead action.

STAFF_TRANSITIONS: dict[str, tuple[str, ...]] = {
    'submitted':         ('triaged', 'in_progress', 'cancelled'),
    'triaged':           ('in_progress', 'cancelled'),
    'in_progress':       ('waiting_requester', 'waiting_approval', 'resolved'),
    'waiting_requester': ('in_progress', 'resolved', 'cancelled'),
    'waiting_approval':  ('in_progress', 'resolved', 'cancelled'),
    'resolved':          ('closed', 'in_progress'),   # re-open path
}

INTERN_TRANSITIONS: dict[str, tuple[str, ...]] = {
    'submitted':         ('in_progress',),
    'triaged':           ('in_progress',),
    'in_progress':       ('waiting_requester', 'resolved'),
    'waiting_requester': ('in_progress', 'resolved'),
    'waiting_approval':  ('in_progress', 'resolved'),
    'resolved':          ('in_progress',),
}


def get_allowed_transitions(user) -> dict[str, tuple[str, ...]]:
    """Return the correct transition table for the given user."""
    from .permissions import user_has_intern_scope_only
    return INTERN_TRANSITIONS if user_has_intern_scope_only(user) else STAFF_TRANSITIONS


class TicketDetail(generics.RetrieveUpdateAPIView):
    serializer_class = TicketSerializer
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_serializer_class(self):
        if self.request.method == 'PATCH':
            from .serializers import TicketUpdateSerializer
            return TicketUpdateSerializer
        return TicketSerializer

    def get_queryset(self):
        from .permissions import get_user_roles, user_has_intern_scope_only, get_intern_scope_slugs
        user = self.request.user
        roles = get_user_roles(user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        qs = Ticket.objects.select_related('category', 'requester', 'assigned_to')
        is_staff = user.is_superuser or bool(roles.intersection(staff_roles))
        if is_staff:
            # Staff can access all tickets (superusers unrestricted; interns scoped)
            if not user.is_superuser and user_has_intern_scope_only(user):
                qs = qs.filter(category__slug__in=get_intern_scope_slugs())
        else:
            # Regular users can only access their own tickets
            qs = qs.filter(requester=user)
        return qs

    def check_patch_permission(self, ticket):
        """Staff can patch anything; requesters cannot patch via this endpoint."""
        from .permissions import get_user_roles
        roles = get_user_roles(self.request.user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        if not roles.intersection(staff_roles):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Only staff may update ticket details.')

    def partial_update(self, request, *args, **kwargs):
        ticket = self.get_object()
        self.check_patch_permission(ticket)
        # Prevent status changes on closed/cancelled tickets
        if ticket.status in ('closed', 'cancelled'):
            from rest_framework.exceptions import ValidationError
            raise ValidationError('This ticket is closed and cannot be edited.')
        return super().partial_update(request, *args, **kwargs)


class TicketStatusView(APIView):
    throttle_classes = (TicketStatusThrottle,)
    """
    POST /api/v1/tickets/{pk}/status/

    Rules:
    - Requester can: cancel (if submitted/triaged), close (if resolved).
    - Staff/intern: must follow STAFF_TRANSITIONS / INTERN_TRANSITIONS tables.
      Terminal states (closed, cancelled) have no outgoing edges.
    """

    def post(self, request, pk):
        from .serializers import TicketStatusSerializer
        from .permissions import get_user_roles

        try:
            ticket = Ticket.objects.select_related('requester').get(pk=pk)
        except Ticket.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = TicketStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data['status']
        reason     = serializer.validated_data.get('reason', '')

        roles = get_user_roles(request.user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        is_staff    = bool(roles.intersection(staff_roles))
        is_requester = ticket.requester_id == request.user.pk

        if not is_staff and not is_requester:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        current = ticket.status

        if current == new_status:
            # No-op — return current state without error
            return Response(TicketSerializer(ticket).data)

        if is_staff:
            table   = get_allowed_transitions(request.user)
            allowed = table.get(current, ())
            if new_status not in allowed:
                label = lambda s: s.replace('_', ' ')
                return Response(
                    {
                        'code':   'invalid_transition',
                        'detail': (
                            f'Cannot move from "{label(current)}" to "{label(new_status)}". '
                            f'Allowed: {", ".join(label(s) for s in allowed) or "none (terminal state)"}.'
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            # Requester: limited set of self-service transitions
            REQUESTER_ALLOWED: dict[str, tuple[str, ...]] = {
                'submitted': ('cancelled',),
                'triaged':   ('cancelled',),
                'resolved':  ('closed',),
            }
            if new_status not in REQUESTER_ALLOWED.get(current, ()):
                return Response(
                    {'detail': f'You cannot move this ticket from "{current}" to "{new_status}".'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        ticket.status = new_status
        # Persist the reason for closed/cancelled/resolved transitions
        if reason:
            ticket.status_reason = reason
        update_fields = ['status', 'updated_at']
        if reason:
            update_fields.append('status_reason')
        ticket.save(update_fields=update_fields)
        return Response(TicketSerializer(ticket).data)


class AssignableStaffView(APIView):
    """GET /api/v1/tickets/assignable-staff/ — users who can be assigned tickets."""
    permission_classes = (IsITAgent,)

    def get(self, request):
        from django.contrib.auth import get_user_model
        from django.db.models import Q
        from django.utils import timezone as tz
        from .models import RoleGrant
        User = get_user_model()
        now = tz.now()
        assignable_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern'}
        staff_ids = RoleGrant.objects.filter(
            role__in=assignable_roles,
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        ).values_list('user_id', flat=True).distinct()
        users = User.objects.filter(pk__in=staff_ids, is_active=True).order_by('first_name', 'username')
        data = [
            {'id': u.pk, 'name': u.get_full_name() or u.username, 'username': u.username}
            for u in users
        ]
        return Response(data)

class TicketAssignView(APIView):
    """
    PATCH /api/v1/tickets/{pk}/assign/

    Who can call this:
    - Service leads and administrators: can assign any eligible staff member,
      change the team, or unassign.
    - IT agents: same as service leads.
    - IT NOC interns (scope-only): can ONLY self-assign (assigned_to must equal
      their own user ID) and only on tickets within their category scope.
      They cannot assign other users or change the team field.
    """
    permission_classes = (IsITAgent,)

    def patch(self, request, pk):
        from rest_framework.exceptions import ValidationError
        from .permissions import get_user_roles, get_intern_scope_slugs, user_has_intern_scope_only

        try:
            ticket = Ticket.objects.select_related('category').get(pk=pk)
        except Ticket.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        caller_is_intern_only = user_has_intern_scope_only(request.user)

        assignee_id = request.data.get('assigned_to')
        team = request.data.get('team')

        # ── Intern restriction: self-assign only ──────────────────────────
        if caller_is_intern_only:
            # Interns can only assign themselves — not arbitrary users
            if assignee_id is not None and int(assignee_id) != request.user.pk:
                return Response(
                    {
                        'code': 'intern_self_assign_only',
                        'detail': 'IT NOC interns can only assign tickets to themselves.',
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            # Interns cannot change the team field
            if team is not None:
                return Response(
                    {
                        'code': 'intern_no_team_change',
                        'detail': 'IT NOC interns cannot change the team.',
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            # Interns can only act on tickets in their category scope
            if ticket.category.slug not in get_intern_scope_slugs():
                return Response(
                    {
                        'code': 'category_not_in_scope',
                        'detail': 'This ticket category is not within your permitted scope.',
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        if assignee_id is not None:
            User = get_user_model()
            try:
                assignee = User.objects.get(pk=assignee_id)
            except User.DoesNotExist:
                return Response({'assigned_to': ['User not found.']}, status=status.HTTP_400_BAD_REQUEST)

            # Validate assignee has a staff role
            ASSIGNABLE_ROLES = {'it_agent', 'it_noc_intern', 'service_lead', 'administrator'}
            assignee_roles = get_user_roles(assignee)
            if not assignee_roles.intersection(ASSIGNABLE_ROLES):
                return Response(
                    {'assigned_to': ['User must hold an IT agent or higher role to be assigned tickets.']},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # If assignee is intern-only, check their category scope
            if user_has_intern_scope_only(assignee):
                if ticket.category.slug not in get_intern_scope_slugs():
                    return Response(
                        {
                            'code': 'category_not_in_scope',
                            'detail': 'This ticket category is not within the permitted scope for this intern.',
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )

            ticket.assigned_to = assignee

        if team is not None:
            ticket.team = team

        # ── Auto-progress: intern self-assignment → in_progress ──────────
        # When an intern takes ownership, move the ticket out of its
        # initial/waiting state so everyone knows work has started.
        if caller_is_intern_only and assignee_id is not None:
            STALE_STATUSES = {'submitted', 'triaged', 'waiting_requester', 'waiting_approval'}
            if ticket.status in STALE_STATUSES:
                ticket.status = 'in_progress'

        ticket.save()
        return Response(TicketSerializer(ticket).data)


class PublicGuideList(generics.ListAPIView):
    throttle_classes = (PublicApiThrottle,)
    permission_classes = (permissions.AllowAny,)
    pagination_class = None
    serializer_class = GuideArticleSerializer

    def get_queryset(self):
        return GuideArticle.objects.filter(
            status=GuideArticle.Status.PUBLISHED,
            audience__in=get_permitted_audiences(self.request),
        ).select_related('created_by', 'updated_by')


class PublicSoftwareList(generics.ListAPIView):
    throttle_classes = (PublicApiThrottle,)
    permission_classes = (permissions.AllowAny,)
    pagination_class = None
    serializer_class = SoftwareResourceSerializer

    def get_queryset(self):
        return SoftwareResource.objects.filter(
            status=SoftwareResource.Status.ACTIVE,
            audience__in=get_permitted_audiences(self.request),
        ).select_related('guide', 'updated_by')


class AdminGuideListCreate(generics.ListCreateAPIView):
    permission_classes = (IsContentEditor,)
    parser_classes = (MultiPartParser, FormParser, JSONParser)
    serializer_class = GuideArticleSerializer
    queryset = GuideArticle.objects.select_related('created_by', 'updated_by')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)


class AdminGuideDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsContentEditor,)
    parser_classes = (MultiPartParser, FormParser, JSONParser)
    serializer_class = GuideArticleSerializer
    queryset = GuideArticle.objects.select_related('created_by', 'updated_by')

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        pdf_file = instance.pdf_file
        instance.delete()
        if pdf_file:
            pdf_file.delete(save=False)


class AdminSoftwareListCreate(generics.ListCreateAPIView):
    permission_classes = (IsContentEditor,)
    serializer_class = SoftwareResourceSerializer
    queryset = SoftwareResource.objects.select_related('guide', 'updated_by')
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get_serializer(self, *args, **kwargs):
        """When multipart/form-data, parse JSON string fields (platforms)."""
        import json as _json
        from django.http import QueryDict

        if 'data' in kwargs:
            data = kwargs['data']
            if isinstance(data, QueryDict):
                data = data.dict()
                if 'platforms' in data and isinstance(data['platforms'], str):
                    try:
                        data['platforms'] = _json.loads(data['platforms'])
                    except (ValueError, TypeError):
                        data['platforms'] = []
                if 'remove_file' in data and isinstance(data['remove_file'], str):
                    data['remove_file'] = data['remove_file'].lower() in ('true', '1', 'yes')
                # file_path is already a plain string — no transformation needed
                kwargs['data'] = data

        return super().get_serializer(*args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)


class AdminSoftwareDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsContentEditor,)
    serializer_class = SoftwareResourceSerializer
    queryset = SoftwareResource.objects.select_related('guide', 'updated_by')
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get_serializer(self, *args, **kwargs):
        """When multipart/form-data, parse JSON string fields (platforms)."""
        import json as _json
        from django.http import QueryDict

        if 'data' in kwargs:
            data = kwargs['data']
            if isinstance(data, QueryDict):
                data = data.dict()
                if 'platforms' in data and isinstance(data['platforms'], str):
                    try:
                        data['platforms'] = _json.loads(data['platforms'])
                    except (ValueError, TypeError):
                        data['platforms'] = []
                if 'remove_file' in data and isinstance(data['remove_file'], str):
                    data['remove_file'] = data['remove_file'].lower() in ('true', '1', 'yes')
                # file_path is already a plain string — no transformation needed
                kwargs['data'] = data

        return super().get_serializer(*args, **kwargs)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        # Delete the uploaded file along with the record
        old_file = instance.file
        instance.delete()
        if old_file:
            old_file.delete(save=False)


class AdminUserPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100
    page_query_param = 'page'

    def get_paginated_response(self, data):
        return Response({
            'count':    self.page.paginator.count,
            'num_pages': self.page.paginator.num_pages,
            'page':     self.page.number,
            'page_size': self.get_page_size(self.request),
            'next':     self.get_next_link(),
            'previous': self.get_previous_link(),
            'results':  data,
        })


class AdminUserList(generics.ListCreateAPIView):
    throttle_classes = (AdminUserWriteThrottle,)
    permission_classes = (IsAdministrator,)
    pagination_class = AdminUserPagination
    serializer_class = AdminUserSerializer

    def get_queryset(self):
        queryset = get_user_model().objects.prefetch_related(
            'rolegrant_set', 'profile',
        ).order_by('-is_superuser', '-is_staff', 'first_name', 'username')
        query = self.request.query_params.get('q', '').strip()
        if query:
            queryset = queryset.filter(
                Q(username__icontains=query) |
                Q(email__icontains=query) |
                Q(first_name__icontains=query) |
                Q(last_name__icontains=query)
            )
        return queryset

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        from .serializers import AdminUserCreateSerializer
        from .models import RoleGrant, RoleAuditEvent

        # Validate base fields
        serializer = AdminUserCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)

        # Email domain check (skip for superusers who may add external accounts)
        email = serializer.validated_data['email']
        if not request.user.is_superuser and not email_domain_allowed(email):
            return Response(
                {'email': ['Email domain is not allowed. Use an approved institutional address.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = serializer.save()

        # Grant initial roles
        initial_roles = request.data.get('initial_roles', [])
        VALID_ROLES = {r[0] for r in RoleGrant.ROLE_CHOICES} if hasattr(RoleGrant, 'ROLE_CHOICES') else {
            'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
            'designated_approver', 'content_editor', 'faculty_staff', 'student', 'visitor',
        }
        if isinstance(initial_roles, list):
            for role_name in initial_roles:
                if role_name in VALID_ROLES:
                    RoleGrant.objects.create(user=user, role=role_name, granted_by=request.user)
                    RoleAuditEvent.objects.create(
                        actor=request.user, target=user,
                        role=role_name, action=RoleAuditEvent.ACTION_GRANTED,
                    )
            # Sync Django flags — grant is_staff for any staff-level role;
            # is_superuser is intentionally NOT set here (requires explicit
            # promotion by a superuser via SetSuperuserView).
            if 'administrator' in initial_roles:
                user.is_staff = True
                user.save(update_fields=['is_staff'])
            elif any(r in initial_roles for r in ('service_lead', 'it_agent', 'it_noc_intern',
                                                    'content_editor', 'designated_approver', 'faculty_staff')):
                user.is_staff = True
                user.save(update_fields=['is_staff'])

        out = AdminUserSerializer(user, context={'request': request})
        return Response(out.data, status=status.HTTP_201_CREATED)


class AdminUserDetail(generics.RetrieveUpdateAPIView):
    throttle_classes = (AdminUserWriteThrottle,)
    permission_classes = (IsAdministrator,)
    serializer_class = AdminUserSerializer
    queryset = get_user_model().objects.all()


class AdminSummaryView(APIView):
    permission_classes = (IsAdministrator,)

    def get(self, request):
        from django.utils import timezone as _tz
        from django.db.models import Count
        from datetime import timedelta, date

        User = get_user_model()
        now  = _tz.now()

        # ── Ticket counts ───────────────────────────────────────────────────
        total_tickets     = Ticket.objects.count()
        open_tickets      = Ticket.objects.exclude(status__in=(
            Ticket.Status.CLOSED, Ticket.Status.CANCELLED)).count()
        submitted_today   = Ticket.objects.filter(
            created_at__date=now.date()).count()
        pending_review    = Ticket.objects.filter(
            status=Ticket.Status.SUBMITTED).count()
        unassigned_open   = Ticket.objects.filter(
            assigned_to__isnull=True
        ).exclude(status__in=(
            Ticket.Status.CLOSED, Ticket.Status.CANCELLED,
            Ticket.Status.RESOLVED)).count()
        resolved_7d       = Ticket.objects.filter(
            status=Ticket.Status.RESOLVED,
            updated_at__gte=now - timedelta(days=7)).count()
        waiting_requester = Ticket.objects.filter(
            status=Ticket.Status.WAITING_REQUESTER).count()

        # ── Chart data ──────────────────────────────────────────────────────

        # 1. Daily ticket volume — last 14 days (created)
        since_14d = now - timedelta(days=13)
        daily_qs  = (
            Ticket.objects
            .filter(created_at__gte=since_14d)
            .extra(select={'day': "DATE(created_at)"})
            .values('day')
            .annotate(count=Count('id'))
            .order_by('day')
        )
        # Build a complete 14-day series (fill gaps with 0)
        daily_map = {row['day']: row['count'] for row in daily_qs}
        daily_series = []
        for i in range(13, -1, -1):
            d = (now - timedelta(days=i)).date()
            daily_series.append({'date': d.isoformat(), 'count': daily_map.get(d, 0)})

        # 2. Status breakdown (current open tickets only)
        status_breakdown = list(
            Ticket.objects
            .exclude(status__in=(Ticket.Status.CLOSED, Ticket.Status.CANCELLED))
            .values('status')
            .annotate(count=Count('id'))
            .order_by('-count')
        )

        # 3. Priority breakdown (all open tickets)
        priority_breakdown = list(
            Ticket.objects
            .exclude(status__in=(Ticket.Status.CLOSED, Ticket.Status.CANCELLED))
            .values('priority')
            .annotate(count=Count('id'))
            .order_by('priority')
        )

        # 4. Resolution trend — daily resolved last 14 days
        resolved_qs = (
            Ticket.objects
            .filter(status=Ticket.Status.RESOLVED, updated_at__gte=since_14d)
            .extra(select={'day': "DATE(updated_at)"})
            .values('day')
            .annotate(count=Count('id'))
            .order_by('day')
        )
        resolved_map = {row['day']: row['count'] for row in resolved_qs}
        resolved_series = []
        for i in range(13, -1, -1):
            d = (now - timedelta(days=i)).date()
            resolved_series.append({'date': d.isoformat(), 'count': resolved_map.get(d, 0)})

        # ── Recent tickets ──────────────────────────────────────────────────
        recent_qs = Ticket.objects.select_related(
            'category', 'requester', 'assigned_to'
        ).order_by('-created_at')[:8]
        recent_tickets = TicketSerializer(
            recent_qs, many=True, context={'request': request}
        ).data

        return Response({
            # User stats
            'users':             User.objects.filter(is_active=True).count(),
            'suspended_users':   User.objects.filter(
                                     is_active=False,
                                     profile__is_suspended=True,
                                 ).count(),
            # Ticket stats
            'tickets':           total_tickets,
            'open_tickets':      open_tickets,
            'submitted_today':   submitted_today,
            'pending_review':    pending_review,
            'unassigned_open':   unassigned_open,
            'resolved_7d':       resolved_7d,
            'waiting_requester': waiting_requester,
            # Content stats
            'guides':            GuideArticle.objects.count(),
            'published_guides':  GuideArticle.objects.filter(
                                     status=GuideArticle.Status.PUBLISHED).count(),
            'software':          SoftwareResource.objects.count(),
            'active_software':   SoftwareResource.objects.filter(
                                     status=SoftwareResource.Status.ACTIVE).count(),
            # Chart data
            'chart_daily':      daily_series,
            'chart_resolved':   resolved_series,
            'chart_status':     status_breakdown,
            'chart_priority':   priority_breakdown,
            # Recent tickets
            'recent_tickets':    recent_tickets,
        })


class AdminDashboardStreamView(View):
    """
    GET /api/v1/admin/summary/stream/

    Plain Django View (not DRF) so the text/event-stream content-type
    is never intercepted by DRF negotiation.

    Pushes a `summary_update` SSE event every 15 seconds containing the
    same payload as AdminSummaryView.GET, so the admin dashboard can update
    its metric cards and charts without a full page reload.

    Sends a heartbeat comment every 15 seconds to keep the connection alive
    through proxies.  Clients reconnect automatically on drop.
    """

    def _build_payload(self, user):
        """Build the same summary dict as AdminSummaryView but callable inline."""
        import json as _json
        from django.utils import timezone as _tz
        from django.db.models import Count
        from datetime import timedelta

        User = get_user_model()
        now  = _tz.now()

        # Daily created series (14 days)
        since_14d  = now - timedelta(days=13)
        daily_qs   = (
            Ticket.objects
            .filter(created_at__gte=since_14d)
            .extra(select={'day': "DATE(created_at)"})
            .values('day').annotate(count=Count('id')).order_by('day')
        )
        daily_map = {row['day']: row['count'] for row in daily_qs}
        daily_series = [
            {'date': (now - timedelta(days=i)).date().isoformat(),
             'count': daily_map.get((now - timedelta(days=i)).date(), 0)}
            for i in range(13, -1, -1)
        ]

        # Resolved series (14 days)
        resolved_qs = (
            Ticket.objects
            .filter(status=Ticket.Status.RESOLVED, updated_at__gte=since_14d)
            .extra(select={'day': "DATE(updated_at)"})
            .values('day').annotate(count=Count('id')).order_by('day')
        )
        resolved_map = {row['day']: row['count'] for row in resolved_qs}
        resolved_series = [
            {'date': (now - timedelta(days=i)).date().isoformat(),
             'count': resolved_map.get((now - timedelta(days=i)).date(), 0)}
            for i in range(13, -1, -1)
        ]

        status_breakdown = list(
            Ticket.objects
            .exclude(status__in=(Ticket.Status.CLOSED, Ticket.Status.CANCELLED))
            .values('status').annotate(count=Count('id')).order_by('-count')
        )
        priority_breakdown = list(
            Ticket.objects
            .exclude(status__in=(Ticket.Status.CLOSED, Ticket.Status.CANCELLED))
            .values('priority').annotate(count=Count('id')).order_by('priority')
        )

        return _json.dumps({
            'users':             User.objects.filter(is_active=True).count(),
            'suspended_users':   User.objects.filter(
                                     is_active=False,
                                     profile__is_suspended=True).count(),
            'tickets':           Ticket.objects.count(),
            'open_tickets':      Ticket.objects.exclude(status__in=(
                                     Ticket.Status.CLOSED,
                                     Ticket.Status.CANCELLED)).count(),
            'submitted_today':   Ticket.objects.filter(
                                     created_at__date=now.date()).count(),
            'pending_review':    Ticket.objects.filter(
                                     status=Ticket.Status.SUBMITTED).count(),
            'unassigned_open':   Ticket.objects.filter(
                                     assigned_to__isnull=True
                                 ).exclude(status__in=(
                                     Ticket.Status.CLOSED,
                                     Ticket.Status.CANCELLED,
                                     Ticket.Status.RESOLVED)).count(),
            'resolved_7d':       Ticket.objects.filter(
                                     status=Ticket.Status.RESOLVED,
                                     updated_at__gte=now - timedelta(days=7)).count(),
            'waiting_requester': Ticket.objects.filter(
                                     status=Ticket.Status.WAITING_REQUESTER).count(),
            'guides':            GuideArticle.objects.count(),
            'published_guides':  GuideArticle.objects.filter(
                                     status=GuideArticle.Status.PUBLISHED).count(),
            'software':          SoftwareResource.objects.count(),
            'active_software':   SoftwareResource.objects.filter(
                                     status=SoftwareResource.Status.ACTIVE).count(),
            'chart_daily':       daily_series,
            'chart_resolved':    resolved_series,
            'chart_status':      status_breakdown,
            'chart_priority':    priority_breakdown,
        })

    def get(self, request):
        import time
        from django.http import StreamingHttpResponse
        from .permissions import get_user_roles

        # Auth check (plain Django session — no DRF pipeline here)
        if not request.user or not request.user.is_authenticated:
            def _unauth():
                yield _sse_format("error", '{"detail":"Authentication required."}')
            r = StreamingHttpResponse(_unauth(), content_type="text/event-stream")
            r["Cache-Control"] = "no-cache"
            r["X-Accel-Buffering"] = "no"
            return r

        # Permission check — administrator role required
        roles = get_user_roles(request.user)
        if 'administrator' not in roles and not request.user.is_superuser:
            def _forbidden():
                yield _sse_format("error", '{"detail":"Admin access required."}')
            r = StreamingHttpResponse(_forbidden(), content_type="text/event-stream")
            r["Cache-Control"] = "no-cache"
            r["X-Accel-Buffering"] = "no"
            return r

        def _stream():
            import time as _time
            # Send initial snapshot immediately on connect
            try:
                yield _sse_format("summary_update", self._build_payload(request.user))
            except Exception:
                return

            # Send updates every 15 s, with heartbeats every 5 s to keep
            # the connection alive through proxies. Cap at 4 minutes total
            # so the connection is refreshed regularly (avoids proxy timeouts
            # and ensures gunicorn sync workers aren't held indefinitely).
            MAX_SECONDS = 240
            elapsed     = 0
            tick        = 5      # check every 5 seconds

            while elapsed < MAX_SECONDS:
                _time.sleep(tick)
                elapsed += tick
                if elapsed % 15 == 0:
                    # Full data update every 15 s
                    try:
                        yield _sse_format("summary_update", self._build_payload(request.user))
                    except Exception:
                        yield _sse_heartbeat()
                else:
                    # Heartbeat to keep proxy alive
                    yield _sse_heartbeat()

            # After MAX_SECONDS the generator ends; the client's onerror
            # fires and it reconnects immediately, getting a fresh snapshot.

        r = StreamingHttpResponse(_stream(), content_type="text/event-stream")
        r["Cache-Control"] = "no-cache"
        r["X-Accel-Buffering"] = "no"
        return r


class UserRoleListCreate(APIView):
    """GET/POST /api/v1/admin/users/<pk>/roles/"""
    permission_classes = (IsAdministrator,)

    def _get_user_or_404(self, pk):
        User = get_user_model()
        try:
            return User.objects.get(pk=pk)
        except User.DoesNotExist:
            return None

    def get(self, request, pk):
        target = self._get_user_or_404(pk)
        if target is None:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        from .models import RoleGrant
        grants = RoleGrant.objects.active_for(target)
        serializer = RoleGrantSerializer(grants, many=True)
        return Response(serializer.data)

    def post(self, request, pk):
        target = self._get_user_or_404(pk)
        if target is None:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = RoleGrantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from .models import RoleGrant, RoleAuditEvent
        from django.db import transaction as db_transaction
        with db_transaction.atomic():
            grant = RoleGrant.objects.create(
                user=target,
                role=serializer.validated_data['role'],
                expires_at=serializer.validated_data.get('expires_at'),
                granted_by=request.user,
            )
            RoleAuditEvent.objects.create(
                actor=request.user,
                target=target,
                role=grant.role,
                action=RoleAuditEvent.ACTION_GRANTED,
            )
            # Sync Django flags — is_staff only; is_superuser requires explicit
            # promotion via SetSuperuserView (superuser-only action).
            if grant.role == 'administrator':
                get_user_model().objects.filter(pk=target.pk).update(is_staff=True)
            elif grant.role in ('service_lead', 'it_agent', 'it_noc_intern', 'content_editor',
                                'designated_approver', 'faculty_staff'):
                get_user_model().objects.filter(pk=target.pk).update(is_staff=True)
        return Response(RoleGrantSerializer(grant).data, status=status.HTTP_201_CREATED)


class UserRoleDetail(APIView):
    """DELETE /api/v1/admin/users/<pk>/roles/<role>/"""
    permission_classes = (IsAdministrator,)

    def delete(self, request, pk, role):
        # Self-revoke guard
        if str(request.user.pk) == str(pk) and role == 'administrator':
            return Response(
                {'code': 'self_revoke_denied', 'detail': 'You cannot revoke your own administrator role.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        User = get_user_model()
        try:
            target = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        from .models import RoleGrant, RoleAuditEvent
        from django.db import transaction as db_transaction
        from django.utils import timezone

        grant = RoleGrant.objects.active_for(target).filter(role=role).first()
        if grant is None:
            return Response({'detail': 'Role grant not found.'}, status=status.HTTP_404_NOT_FOUND)

        with db_transaction.atomic():
            # Revoke by setting expires_at to now
            grant.expires_at = timezone.now()
            grant.save(update_fields=['expires_at'])
            RoleAuditEvent.objects.create(
                actor=request.user,
                target=target,
                role=role,
                action=RoleAuditEvent.ACTION_REVOKED,
            )
            # Sync flags for administrator revocation: clear both is_staff and
            # is_superuser only when no active administrator grant remains.
            if role == 'administrator':
                remaining = RoleGrant.objects.active_for(target).filter(role='administrator').exists()
                if not remaining:
                    User.objects.filter(pk=target.pk).update(is_superuser=False, is_staff=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminServiceCategoryList(generics.ListCreateAPIView):
    permission_classes = (IsServiceLead,)
    serializer_class = AdminServiceCategorySerializer
    pagination_class = None

    def get_queryset(self):
        return ServiceCategory.objects.order_by('sort_order', 'name')


class AdminServiceCategoryDetail(generics.RetrieveUpdateAPIView):
    permission_classes = (IsServiceLead,)
    serializer_class = AdminServiceCategorySerializer
    queryset = ServiceCategory.objects.all()
    http_method_names = ['get', 'patch', 'head', 'options']


class AdminServiceCategoryReorder(APIView):
    permission_classes = (IsServiceLead,)

    def post(self, request):
        data = request.data
        if not isinstance(data, list):
            return Response({'detail': 'Payload must be a JSON array.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(data) > 100:
            return Response({'detail': 'Payload may contain at most 100 items.'}, status=status.HTTP_400_BAD_REQUEST)
        # Validate each item
        for item in data:
            if not isinstance(item, dict) or 'id' not in item or 'sort_order' not in item:
                return Response({'detail': 'Each item must have id and sort_order.'}, status=status.HTTP_400_BAD_REQUEST)
            if not isinstance(item['sort_order'], int) or not (0 <= item['sort_order'] <= 32767):
                return Response({'detail': 'sort_order must be an integer between 0 and 32767.'}, status=status.HTTP_400_BAD_REQUEST)
        # Verify all ids exist
        ids = [item['id'] for item in data]
        found_ids = set(ServiceCategory.objects.filter(pk__in=ids).values_list('pk', flat=True))
        missing = [i for i in ids if i not in found_ids]
        if missing:
            return Response({'detail': f'Category id(s) not found: {missing}.'}, status=status.HTTP_400_BAD_REQUEST)
        # Apply atomically
        from django.db import transaction as db_transaction
        with db_transaction.atomic():
            for item in data:
                ServiceCategory.objects.filter(pk=item['id']).update(sort_order=item['sort_order'])
        return Response({'detail': 'Sort order updated.'}, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Ticket messaging
# ---------------------------------------------------------------------------

class TicketMessageListCreate(APIView):
    """
    GET  /api/v1/tickets/{pk}/messages/ — list messages
    POST /api/v1/tickets/{pk}/messages/ — post a reply or note

    Access rules:
    - Requester can read public messages (is_internal=False) and post replies
    - Staff (including IT NOC intern scoped to ticket) can read all + post replies/notes
    - is_internal messages are never returned to requesters
    """
    throttle_classes = (TicketMessageThrottle,)

    def _get_ticket_and_check_access(self, request, pk):
        """Returns (ticket, is_staff) or raises 404."""
        from .permissions import get_user_roles, user_has_intern_scope_only, get_intern_scope_slugs
        roles = get_user_roles(request.user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        is_staff = bool(roles.intersection(staff_roles))

        try:
            qs = Ticket.objects.select_related('category', 'requester', 'assigned_to')
            if is_staff:
                if user_has_intern_scope_only(request.user):
                    qs = qs.filter(category__slug__in=get_intern_scope_slugs())
                ticket = qs.get(pk=pk)
            else:
                ticket = qs.get(pk=pk, requester=request.user)
        except Ticket.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound()

        return ticket, is_staff

    def get(self, request, pk):
        ticket, is_staff = self._get_ticket_and_check_access(request, pk)
        qs = ticket.messages.select_related('sender')
        if not is_staff:
            qs = qs.filter(is_internal=False)
        serializer = TicketMessageSerializer(qs, many=True)
        return Response(serializer.data)

    def post(self, request, pk):
        ticket, is_staff = self._get_ticket_and_check_access(request, pk)

        body = (request.data.get('body') or '').strip()
        if not body:
            return Response({'body': ['Message body cannot be empty.']},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(body) > 5000:
            return Response({'body': ['Message must be 5000 characters or fewer.']},
                            status=status.HTTP_400_BAD_REQUEST)

        is_internal = bool(request.data.get('is_internal', False)) and is_staff

        msg = TicketMessage.objects.create(
            ticket=ticket,
            sender=request.user,
            body=body,
            is_staff_reply=is_staff,
            is_internal=is_internal,
        )

        # Send notification for public staff replies
        if is_staff and not is_internal:
            try:
                from .notifications import send_event
                from .signals import _ticket_context, get_helpdesk_url
                ctx = _ticket_context(ticket, {
                    'reply_body': body,
                    'staff_name': request.user.get_full_name() or request.user.username,
                })
                send_event('ticket_reply', ctx, ticket=ticket)
            except Exception as exc:
                import logging
                logging.getLogger(__name__).exception('Error sending reply notification: %s', exc)

        serializer = TicketMessageSerializer(msg)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Account recovery backup code
# ---------------------------------------------------------------------------

class AccountRecoveryCodeView(APIView):
    """
    POST /api/v1/tickets/{pk}/recovery-code/
    Generates an 8-digit backup code + temp password for an account recovery ticket
    and sends it via active email channels.
    Requires IsServiceLead or IsAdministrator.
    """
    permission_classes = (IsServiceLead,)

    def post(self, request, pk):
        import random
        import string
        from django.utils import timezone as tz
        from .notifications import send_event
        from .signals import get_helpdesk_url, get_support_email

        try:
            ticket = Ticket.objects.select_related('requester', 'category').get(pk=pk)
        except Ticket.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        _RECOVERY_SLUGS = {'account-recovery', 'college-account-recovery'}
        if ticket.category.slug not in _RECOVERY_SLUGS:
            return Response(
                {'detail': 'This endpoint is only for account recovery tickets.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Generate / regenerate the token
        backup_code = ''.join(random.choices(string.digits, k=8))
        temp_password = ''.join(
            random.choices(string.ascii_letters + string.digits + '!@#$', k=12)
        )

        token, _ = AccountRecoveryToken.objects.update_or_create(
            ticket=ticket,
            defaults={
                'backup_code': backup_code,
                'temp_password': temp_password,
                'is_used': False,
                'used_at': None,
            },
        )

        # Send via notification system
        requester = ticket.requester
        ctx = {
            'ticket_reference': ticket.reference,
            'ticket_subject': ticket.subject,
            'requester_name': requester.get_full_name() or requester.username,
            'requester_email': requester.email,
            'to_email': requester.email,
            'college_email': requester.email,
            'support_email': get_support_email(),
            'backup_code': backup_code,
            'temp_password': temp_password,
            'helpdesk_url': get_helpdesk_url(),
        }
        try:
            send_event('account_recovery', ctx, ticket=ticket)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).exception('Error sending recovery code: %s', exc)

        return Response({
            'backup_code': backup_code,
            'temp_password': temp_password,
            'message': f'Recovery code sent to {requester.email}.',
        })


# ---------------------------------------------------------------------------
# Recovery action dispatcher
# ---------------------------------------------------------------------------

class RecoveryActionView(APIView):
    """
    POST /api/v1/tickets/{pk}/recovery-action/

    Unified endpoint for all admin actions on an account-recovery ticket.

    Body
    ────
    {
      "action": "send_credentials" | "unable_to_verify" | "close_ticket",
      "close_reason": "...",   // only for close_ticket (optional, max 500 chars)
    }

    Actions
    ───────
    send_credentials
        • Generates a fresh 8-digit backup code + 12-char temporary password.
        • Saves them to AccountRecoveryToken (upsert, resets is_used).
        • Emails them to the requester via the `account_recovery` email template.
        • Returns { backup_code, temp_password } so the admin can read them out
          in person / over the counter as a double-check.

    unable_to_verify
        • Sends a `recovery_unable_to_verify` notification email to the requester
          explaining that their identity could not be confirmed.
        • Does NOT close the ticket — the admin can do that separately or later.
        • Returns { detail } confirmation.

    close_ticket
        • Sets the ticket status to "closed" with an optional reason.
        • Does NOT send an email (use a separate message/reply for that).
        • Returns { detail } confirmation.

    Permission: IsServiceLead (service leads + administrators).
    """
    permission_classes = (IsServiceLead,)

    _RECOVERY_SLUGS = frozenset({'account-recovery', 'college-account-recovery'})

    def _get_ticket(self, pk):
        try:
            return Ticket.objects.select_related('requester', 'category').get(pk=pk)
        except Ticket.DoesNotExist:
            return None

    def _check_is_recovery(self, ticket):
        return ticket.category.slug in self._RECOVERY_SLUGS

    # ── POST ──────────────────────────────────────────────────────────────────

    def post(self, request, pk):
        from .notifications import send_event
        from .signals import get_helpdesk_url

        ticket = self._get_ticket(pk)
        if ticket is None:
            return Response({'detail': 'Ticket not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not self._check_is_recovery(ticket):
            return Response(
                {'detail': 'This action is only available for account recovery tickets.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        action = str(request.data.get('action', '')).strip()
        if action not in ('send_credentials', 'unable_to_verify', 'close_ticket'):
            return Response(
                {'detail': 'Invalid action. Choose send_credentials, unable_to_verify, or close_ticket.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requester = ticket.requester
        if requester is None:
            return Response({'detail': 'Ticket has no requester.'}, status=status.HTTP_400_BAD_REQUEST)

        # ── Action: send_credentials ──────────────────────────────────────────
        if action == 'send_credentials':
            return self._send_credentials(request, ticket, requester, send_event, get_helpdesk_url)

        # ── Action: unable_to_verify ──────────────────────────────────────────
        if action == 'unable_to_verify':
            return self._unable_to_verify(request, ticket, requester, send_event, get_helpdesk_url)

        # ── Action: close_ticket ──────────────────────────────────────────────
        return self._close_ticket(request, ticket)

    # ── send_credentials ──────────────────────────────────────────────────────

    def _send_credentials(self, request, ticket, requester, send_event, get_helpdesk_url):
        import random, string
        from .email_config_service import get_effective_from_email
        from .email_utils import render_email, send_email_async
        from .signals import get_support_email as _get_support_email
        from .models import SiteSettings

        raw_backup   = request.data.get('backup_code',   None)
        raw_password = request.data.get('temp_password', None)

        if raw_backup is None:
            backup_code       = ''.join(random.choices(string.digits, k=8))
            email_backup_code = backup_code
        else:
            backup_code       = str(raw_backup).strip()[:8]
            email_backup_code = backup_code if backup_code else 'N/A'

        if raw_password is None:
            temp_password       = ''.join(random.choices(string.ascii_letters + string.digits + '!@#$', k=12))
            email_temp_password = temp_password
        else:
            temp_password       = str(raw_password).strip()[:100]
            email_temp_password = temp_password if temp_password else 'N/A'

        AccountRecoveryToken.objects.update_or_create(
            ticket=ticket,
            defaults={
                'backup_code':   backup_code,
                'temp_password': temp_password,
                'is_used':       False,
                'used_at':       None,
            },
        )

        name         = requester.get_full_name() or requester.username
        ref          = ticket.reference
        helpdesk_url = get_helpdesk_url()

        # ── Resolve destination email ──────────────────────────────────────
        # Read the admin-configured preference from SiteSettings.
        site = SiteSettings.get()
        destination = site.recovery_credentials_destination  # 'college' or 'alternative'

        to_email = requester.email  # default: college email
        destination_label = 'college email'

        if destination == 'alternative':
            # Pull the personal/alternative email from ticket extra_fields.
            # Key matches the account-recovery form schema field "alternative_contact".
            alt = str(ticket.extra_fields.get('alternative_contact', '') or '').strip()
            if alt:
                to_email = alt
                destination_label = f'alternative email ({alt})'
            else:
                # Field not filled in — fall back to college email and log a warning
                import logging as _log
                _log.getLogger(__name__).warning(
                    'RecoveryActionView: alternative_contact empty for ticket %s; '
                    'falling back to college email %s.',
                    ref, requester.email,
                )

        plain = (
            f"Hi {name},\n\n"
            f"Your IIC college account recovery credentials are ready (ref: {ref}).\n\n"
            f"  College email     : {requester.email}\n"
            f"  Backup code       : {email_backup_code}\n"
            f"  Temporary password: {email_temp_password}\n\n"
            f"Please change your password immediately after signing in.\n"
            f"These credentials are single-use and should not be shared.\n\n"
            f"If you did not request this, contact us at {_get_support_email()} immediately.\n\n"
            f"Helpdesk: {helpdesk_url}\n\n"
            f"\u2014 IIC IT & NOC Department"
        )

        html = render_email('email/recovery_credentials.html', {
            'name':             name,
            'college_email':    requester.email,
            'ticket_reference': ref,
            'backup_code':      email_backup_code,
            'temp_password':    email_temp_password,
            'support_email':    _get_support_email(),
            'helpdesk_url':     helpdesk_url,
        })

        send_email_async(
            subject    = f'[IIC IT Helpdesk] Account recovery credentials \u2014 {ref}',
            plain      = plain,
            html       = html,
            to         = to_email,
            from_email = get_effective_from_email(),
            log_tag    = f'recovery_credentials ticket={ref} dest={destination_label}',
        )

        return Response({
            'action':        'send_credentials',
            'backup_code':   email_backup_code,
            'temp_password': email_temp_password,
            'sent_to':       to_email,
            'message':       f'Credentials emailed to {to_email}.',
        })

    # ── unable_to_verify ──────────────────────────────────────────────────────

    def _unable_to_verify(self, request, ticket, requester, send_event, get_helpdesk_url):
        from .email_config_service import get_effective_from_email
        from .email_utils import render_email, send_email_async

        name         = requester.get_full_name() or requester.username
        ref          = ticket.reference
        helpdesk_url = get_helpdesk_url()

        plain = (
            f"Hi {name},\n\n"
            f"Thank you for submitting an account recovery request (ref: {ref}).\n\n"
            f"Unfortunately, the IIC IT team was unable to verify your identity with the "
            f"information provided. Your request cannot be processed at this time.\n\n"
            f"Please visit the IIC IT & NOC department in person with a valid college ID "
            f"or other approved identification.\n\n"
            f"Office hours: Sunday\u2013Friday, 10:00 AM \u2013 4:00 PM\n\n"
            f"Questions? Contact us at {_get_support_email()}.\n\n"
            f"Helpdesk: {helpdesk_url}\n\n"
            f"\u2014 IIC IT & NOC Department"
        )

        html = render_email('email/recovery_unable_to_verify.html', {
            'name':             name,
            'college_email':    requester.email,
            'ticket_reference': ref,
            'support_email':    _get_support_email(),
            'helpdesk_url':     helpdesk_url,
        })

        send_email_async(
            subject    = f'[IIC IT Helpdesk] Account recovery update \u2014 {ref}',
            plain      = plain,
            html       = html,
            to         = requester.email,
            from_email = get_effective_from_email(),
            log_tag    = f'recovery_unable_to_verify ticket={ref}',
        )

        return Response({
            'action':  'unable_to_verify',
            'message': f'Unable-to-verify notification emailed to {requester.email}.',
        })

    # ── close_ticket ──────────────────────────────────────────────────────────

    def _close_ticket(self, request, ticket):
        if ticket.status in ('closed', 'cancelled'):
            return Response(
                {'detail': f'Ticket is already {ticket.status}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        close_reason = str(request.data.get('close_reason', '')).strip()[:500]

        with transaction.atomic():
            ticket.status = 'closed'
            if close_reason:
                ticket.status_reason = close_reason
            ticket.save(update_fields=['status', 'status_reason'])

        return Response({
            'action':  'close_ticket',
            'status':  'closed',
            'message': 'Ticket closed.',
        })


# ---------------------------------------------------------------------------
# Ticket Attachments
# ---------------------------------------------------------------------------

class TicketAttachmentListView(APIView):
    """
    GET /api/v1/tickets/{pk}/attachments/
    Returns the list of file attachments for a ticket.
    Accessible by the requester and by any staff member who can view the ticket.
    """

    def _get_ticket_and_check_access(self, request, pk):
        from .permissions import get_user_roles
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        roles = get_user_roles(request.user)
        is_staff = bool(roles.intersection(staff_roles))
        try:
            from uuid import UUID
            ticket = Ticket.objects.get(pk=UUID(pk))
        except (Ticket.DoesNotExist, ValueError):
            return None, False
        if not is_staff and ticket.requester_id != request.user.id:
            return None, False
        return ticket, is_staff

    def get(self, request, pk):
        ticket, _ = self._get_ticket_and_check_access(request, pk)
        if ticket is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        attachments = TicketAttachment.objects.filter(ticket=ticket)
        serializer = TicketAttachmentSerializer(
            attachments, many=True, context={'request': request}
        )
        return Response(serializer.data)


class TicketEventListView(APIView):
    """
    GET /api/v1/tickets/{pk}/events/
    Returns the immutable audit-log events for a ticket.

    Access rules mirror TicketDetail:
    - Requester can see events on their own tickets.
    - Staff (including interns scoped to the category) can see events on any
      ticket they are permitted to access.
    """

    def _get_ticket_and_check_access(self, request, pk):
        from .permissions import get_user_roles, user_has_intern_scope_only, get_intern_scope_slugs
        from uuid import UUID

        roles = get_user_roles(request.user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        is_staff = bool(roles.intersection(staff_roles)) or request.user.is_superuser

        try:
            ticket = Ticket.objects.select_related('category').get(pk=UUID(pk))
        except (Ticket.DoesNotExist, ValueError):
            return None, False

        if is_staff:
            if not request.user.is_superuser and user_has_intern_scope_only(request.user):
                if ticket.category and ticket.category.slug not in get_intern_scope_slugs():
                    return None, False
        else:
            if ticket.requester_id != request.user.pk:
                return None, False

        return ticket, is_staff

    def get(self, request, pk):
        ticket, _ = self._get_ticket_and_check_access(request, pk)
        if ticket is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        from .models import TicketEvent
        from .serializers import TicketEventSerializer
        events = ticket.events.select_related('actor').order_by('created_at')
        serializer = TicketEventSerializer(events, many=True)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Notification Channels, Templates, and Logs
# ---------------------------------------------------------------------------

class NotificationChannelListCreate(generics.ListCreateAPIView):
    permission_classes = (IsAdministrator,)
    serializer_class = NotificationChannelSerializer
    pagination_class = None

    def get_queryset(self):
        return NotificationChannel.objects.all()


class NotificationChannelDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsAdministrator,)
    serializer_class = NotificationChannelSerializer
    queryset = NotificationChannel.objects.all()
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']


class NotificationChannelTestView(APIView):
    permission_classes = (IsAdministrator,)

    def post(self, request):
        from .notifications import test_channel, merge_config, mask_config
        from .models import NotificationChannel as NC

        channel_id = request.data.get('id')
        if channel_id:
            try:
                channel = NC.objects.get(pk=channel_id)
                success, message = test_channel(channel.type, channel.config)
            except NC.DoesNotExist:
                return Response({'detail': 'Channel not found.'}, status=status.HTTP_404_NOT_FOUND)
        else:
            channel_type = request.data.get('type')
            config = request.data.get('config', {})
            if not channel_type:
                return Response({'detail': 'Provide either id or type+config.'}, status=status.HTTP_400_BAD_REQUEST)
            success, message = test_channel(channel_type, config)

        return Response({'success': success, 'message': message})


class EmailTemplateListCreate(generics.ListCreateAPIView):
    permission_classes = (IsAdministrator,)
    serializer_class = EmailTemplateSerializer
    pagination_class = None
    queryset = EmailTemplate.objects.all()


class EmailTemplateDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsAdministrator,)
    serializer_class = EmailTemplateSerializer
    queryset = EmailTemplate.objects.all()
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']


class NotificationLogListView(generics.ListAPIView):
    permission_classes = (IsAdministrator,)
    serializer_class = NotificationLogSerializer

    def get_queryset(self):
        qs = NotificationLog.objects.select_related('channel', 'ticket')
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs


class NotificationRuleListCreate(generics.ListCreateAPIView):
    permission_classes = (IsAdministrator,)
    serializer_class = NotificationRuleSerializer
    pagination_class = None

    def get_queryset(self):
        return NotificationRule.objects.select_related('channel')


class NotificationRuleDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsAdministrator,)
    serializer_class = NotificationRuleSerializer
    queryset = NotificationRule.objects.select_related('channel')
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']


# ---------------------------------------------------------------------------
# Admin settings — Ticket Form
# ---------------------------------------------------------------------------

class TicketFormSettingsView(APIView):
    """
    GET  /api/v1/admin/settings/ticket-form/  — return current settings (public, no auth)
    PATCH /api/v1/admin/settings/ticket-form/ — update settings (admin only)
    """
    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.AllowAny()]
        return [IsAdministrator()]

    def get(self, request):
        obj = TicketFormSettings.get()
        return Response(TicketFormSettingsSerializer(obj).data)

    def patch(self, request):
        obj = TicketFormSettings.get()
        serializer = TicketFormSettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class SiteSettingsView(APIView):
    """
    GET   /api/v1/settings/site/        — public read (no auth required)
    PATCH /api/v1/admin/settings/site/  — admin write

    Contact info, office hours, and footer copy are stored here so they
    can be updated without a code change or redeployment.
    """

    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.AllowAny()]
        return [IsAdministrator()]

    def get(self, request):
        obj = SiteSettings.get()
        return Response(SiteSettingsSerializer(obj).data)

    def patch(self, request):
        obj = SiteSettings.get()
        serializer = SiteSettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Admin settings — Roles
# ---------------------------------------------------------------------------

ROLE_DEFAULTS = {
    'administrator':       ('Full access to the staff portal and all management functions.',       True),
    'service_lead':        ('Triage, assign, escalate tickets and run team reports.',              True),
    'it_agent':            ('Work assigned queues, post replies and internal notes.',              False),
    'it_noc_intern':       ('IT Agent scoped to Laptop, Wi-Fi and General IT tickets.',            False),
    'designated_approver': ('Review approval tasks for ID replacement and CCTV tickets.',         False),
    'content_editor':      ('Draft, revise and publish guides and software resources.',            False),
    'faculty_staff':       ('Access staff-eligible services and guides.',                          False),
    'student':             ('Submit requests and access student resources.',                       False),
    'visitor':             ('Public-only access (unauthenticated default).',                       False),
}


def _ensure_role_configs():
    """Create RoleConfig rows for any roles that don't have one yet."""
    for role, (desc, can_export) in ROLE_DEFAULTS.items():
        RoleConfig.objects.get_or_create(
            role=role,
            defaults={'description': desc, 'is_grantable': True, 'can_export': can_export},
        )


class RoleConfigListView(APIView):
    """
    GET  /api/v1/admin/settings/roles/  — list all role configs (admin only)
    """
    permission_classes = (IsAdministrator,)

    def get(self, request):
        _ensure_role_configs()
        configs = RoleConfig.objects.all().order_by('role')
        serializer = RoleConfigSerializer(configs, many=True)
        return Response(serializer.data)


class RoleConfigDetailView(APIView):
    """
    PATCH /api/v1/admin/settings/roles/{role}/  — update a single role config (admin only)
    """
    permission_classes = (IsAdministrator,)

    def patch(self, request, role):
        try:
            obj = RoleConfig.objects.get(role=role)
        except RoleConfig.DoesNotExist:
            _ensure_role_configs()
            try:
                obj = RoleConfig.objects.get(role=role)
            except RoleConfig.DoesNotExist:
                return Response({'detail': f'Unknown role: {role}'}, status=status.HTTP_404_NOT_FOUND)

        serializer = RoleConfigSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class InternScopeListView(APIView):
    """
    GET   /api/v1/admin/settings/intern-scope/  — list intern category scopes
    POST  /api/v1/admin/settings/intern-scope/  — add a slug
    DELETE /api/v1/admin/settings/intern-scope/{slug}/ — remove a slug
    """
    permission_classes = (IsAdministrator,)

    def get(self, request):
        from .models import InternCategoryScope
        scopes = InternCategoryScope.objects.all().order_by('slug')
        return Response([
            {'slug': s.slug, 'description': s.description, 'is_active': s.is_active}
            for s in scopes
        ])

    def post(self, request):
        from .models import InternCategoryScope
        slug = str(request.data.get('slug', '')).strip()
        desc = str(request.data.get('description', '')).strip()
        if not slug:
            return Response({'detail': 'slug is required.'}, status=status.HTTP_400_BAD_REQUEST)
        obj, created = InternCategoryScope.objects.get_or_create(
            slug=slug, defaults={'description': desc, 'is_active': True}
        )
        if not created:
            obj.is_active = True
            obj.description = desc or obj.description
            obj.save()
        return Response(
            {'slug': obj.slug, 'description': obj.description, 'is_active': obj.is_active},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class InternScopeDetailView(APIView):
    """PATCH / DELETE a single intern scope slug."""
    permission_classes = (IsAdministrator,)

    def patch(self, request, slug):
        from .models import InternCategoryScope
        try:
            obj = InternCategoryScope.objects.get(slug=slug)
        except InternCategoryScope.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if 'is_active' in request.data:
            obj.is_active = bool(request.data['is_active'])
        if 'description' in request.data:
            obj.description = str(request.data['description'])
        obj.save()
        return Response({'slug': obj.slug, 'description': obj.description, 'is_active': obj.is_active})

    def delete(self, request, slug):
        from .models import InternCategoryScope
        InternCategoryScope.objects.filter(slug=slug).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Audit-grade Excel Export
# ---------------------------------------------------------------------------

class TicketExportView(APIView):
    throttle_classes = (ExportThrottle,)
    """
    GET /api/v1/admin/tickets/export/
        ?status=submitted,resolved
        &priority=p1,p2
        &category=wifi-issue
        &from=2026-01-01   (ISO date, inclusive)
        &to=2026-12-31     (ISO date, inclusive)
        &format=xlsx       (default; only xlsx supported)

    Returns an Excel workbook with two sheets:
      1. Ticket Register — one row per ticket, all fields, audit-safe timestamps
      2. Analytics Summary — KPIs, status/priority/category breakdowns, SLA buckets

    Access: any role whose RoleConfig.can_export is True, plus superusers.
    """
    permission_classes = (permissions.IsAuthenticated,)

    def _check_export_permission(self, request):
        """Return True if the caller has export permission via RoleConfig or is superuser."""
        if request.user.is_superuser:
            return True
        from .permissions import get_user_roles
        roles = get_user_roles(request.user)
        if not roles:
            return False
        _ensure_role_configs()
        allowed = set(
            RoleConfig.objects.filter(role__in=roles, can_export=True)
            .values_list('role', flat=True)
        )
        return bool(allowed)

    # -- Helpers --------------------------------------------------------------

    @staticmethod
    def _parse_date(value: str | None):
        from datetime import date, datetime, timezone as dt_timezone
        if not value:
            return None
        try:
            d = date.fromisoformat(value)
            # Convert to start-of-day UTC-aware datetime
            return datetime(d.year, d.month, d.day, tzinfo=dt_timezone.utc)
        except ValueError:
            return None

    @staticmethod
    def _duration_str(td) -> str:
        """Convert a timedelta to a human-readable HH:MM string."""
        if td is None:
            return "—"
        total_seconds = int(td.total_seconds())
        hours, remainder = divmod(abs(total_seconds), 3600)
        minutes = remainder // 60
        return f"{hours}h {minutes:02d}m"

    @staticmethod
    def _sla_bucket(hours: float) -> str:
        if hours <= 4:   return "= 4h"
        if hours <= 8:   return "= 8h"
        if hours <= 24:  return "= 24h"
        if hours <= 72:  return "= 3d"
        if hours <= 168: return "= 7d"
        return "> 7d"

    # -- Build workbook --------------------------------------------------------

    def _build_workbook(self, tickets):
        import openpyxl
        from openpyxl.styles import (
            PatternFill, Font, Alignment, Border, Side,
        )
        from openpyxl.utils import get_column_letter
        from openpyxl.drawing.image import Image as XLImage
        from django.utils import timezone
        from collections import Counter
        from datetime import timedelta
        import os

        wb = openpyxl.Workbook()

        # -- Style constants -------------------------------------------------

        brand_fill   = PatternFill("solid", fgColor="234395")
        header_font  = Font(bold=True, color="FFFFFF", name="Calibri", size=10)
        header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)

        alt_fill     = PatternFill("solid", fgColor="EEF2FF")
        white_fill   = PatternFill("solid", fgColor="FFFFFF")
        normal_font  = Font(name="Calibri", size=10)
        center_align = Alignment(horizontal="center", vertical="center")
        left_align   = Alignment(horizontal="left",   vertical="center", wrap_text=False)

        thin = Side(style="thin", color="CBD5E1")
        border = Border(left=thin, right=thin, top=thin, bottom=thin)

        status_fills = {
            "submitted":         PatternFill("solid", fgColor="DBEAFE"),
            "triaged":           PatternFill("solid", fgColor="EDE9FE"),
            "in_progress":       PatternFill("solid", fgColor="FEF3C7"),
            "waiting_requester": PatternFill("solid", fgColor="FFEDD5"),
            "waiting_approval":  PatternFill("solid", fgColor="F3E8FF"),
            "resolved":          PatternFill("solid", fgColor="DCFCE7"),
            "closed":            PatternFill("solid", fgColor="E2E8F0"),
            "cancelled":         PatternFill("solid", fgColor="FEE2E2"),
        }

        priority_fills = {
            "p1": PatternFill("solid", fgColor="FEE2E2"),
            "p2": PatternFill("solid", fgColor="FEF3C7"),
            "p3": PatternFill("solid", fgColor="E2E8F0"),
            "p4": PatternFill("solid", fgColor="DCFCE7"),
        }

        action_fills = {
            "created":          PatternFill("solid", fgColor="DCFCE7"),
            "status_changed":   PatternFill("solid", fgColor="DBEAFE"),
            "priority_changed": PatternFill("solid", fgColor="FEF3C7"),
            "assigned":         PatternFill("solid", fgColor="EDE9FE"),
            "stage_changed":    PatternFill("solid", fgColor="F3E8FF"),
            "subject_changed":  PatternFill("solid", fgColor="FFEDD5"),
            "team_changed":     PatternFill("solid", fgColor="E0F2FE"),
        }

        role_action_fills = {
            "granted": PatternFill("solid", fgColor="DCFCE7"),
            "revoked":  PatternFill("solid", fgColor="FEE2E2"),
        }

        priority_labels = {"p1": "Critical", "p2": "High", "p3": "Normal", "p4": "Low"}
        status_labels   = {
            "submitted": "Submitted", "triaged": "Triaged",
            "in_progress": "In Progress", "waiting_requester": "Waiting",
            "waiting_approval": "Awaiting Approval", "resolved": "Resolved",
            "closed": "Closed", "cancelled": "Cancelled",
        }
        action_labels = {
            "created":          "Created",
            "status_changed":   "Status changed",
            "priority_changed": "Priority changed",
            "assigned":         "Assigned / reassigned",
            "stage_changed":    "Stage changed",
            "subject_changed":  "Subject edited",
            "team_changed":     "Team changed",
        }

        now_utc  = timezone.now()
        iso_now  = now_utc.strftime("%Y-%m-%d %H:%M UTC")

        # -- Shared helpers --------------------------------------------------

        def write_sheet_logo(ws, anchor: str = "A1"):
            """Insert the IIC logo into a worksheet if the file exists."""
            logo_path = os.path.join(os.path.dirname(__file__), "iic-logo.png")
            if os.path.exists(logo_path):
                img = XLImage(logo_path)
                # Scale to ~120px tall keeping aspect ratio (860x460 → ~225x120)
                img.width  = 225
                img.height = 120
                ws.add_image(img, anchor)

        def styled_header_row(ws, row_num: int, col_defs: list[tuple[str, int]]):
            for col_idx, (title, width) in enumerate(col_defs, start=1):
                cell = ws.cell(row=row_num, column=col_idx, value=title)
                cell.fill      = brand_fill
                cell.font      = header_font
                cell.alignment = header_align
                cell.border    = border
                ws.column_dimensions[get_column_letter(col_idx)].width = width
            ws.row_dimensions[row_num].height = 28

        def style_data_row(ws, row_num: int, num_cols: int, alt: bool,
                           override_fill=None):
            base = override_fill if override_fill else (alt_fill if alt else white_fill)
            for c in range(1, num_cols + 1):
                cell = ws.cell(row=row_num, column=c)
                if not override_fill:
                    cell.fill = base
                cell.font   = normal_font
                cell.border = border

        # -- Collect extra_field keys ----------------------------------------

        extra_keys: list[str] = []
        seen_extra: set[str]  = set()
        for t in tickets:
            for k in (t.extra_fields or {}).keys():
                if k not in seen_extra:
                    extra_keys.append(k)
                    seen_extra.add(k)

        ticket_ids = [t.pk for t in tickets]

        # =================================================================
        # SHEET 1 — Ticket Register
        # =================================================================

        ws1 = wb.active
        ws1.title = "Ticket Register"
        ws1.sheet_view.showGridLines = True

        # Logo block (rows 1-6, cols A-C)
        write_sheet_logo(ws1, "A1")
        ws1.row_dimensions[1].height = 30
        ws1.row_dimensions[2].height = 30
        ws1.row_dimensions[3].height = 30
        ws1.row_dimensions[4].height = 30

        # Title / meta block (to the right of logo, col D+)
        LOGO_ROWS = 5   # logo occupies ~120px ≈ 5 rows at default height

        ws1.merge_cells(f"D1:L1")
        tc = ws1["D1"]
        tc.value     = "IIC IT Helpdesk — Ticket Register (Audit Export)"
        tc.font      = Font(bold=True, size=14, color="234395", name="Calibri")
        tc.alignment = Alignment(horizontal="left", vertical="center")

        ws1.merge_cells(f"D2:L2")
        ws1["D2"].value = f"Generated: {iso_now}    Tickets included: {len(tickets)}"
        ws1["D2"].font  = Font(size=9, italic=True, color="64748B", name="Calibri")

        ws1.merge_cells(f"D3:L3")
        ws1["D3"].value = "Itahari International College — IT & NOC Support"
        ws1["D3"].font  = Font(size=9, color="64748B", name="Calibri")

        # Column definitions
        fixed_cols: list[tuple[str, int]] = [
            ("Reference",        14),
            ("Category",         22),
            ("Subject",          40),
            ("Status",           16),
            ("Priority",         12),
            ("Stage",            18),
            ("Requester Name",   22),
            ("Requester Email",  28),
            ("Assigned To",      22),
            ("Team",             16),
            ("Created (UTC)",    20),
            ("Updated (UTC)",    20),
            ("Resolved (UTC)",   20),
            ("Age at Export",    16),
            ("Resolution Time",  16),
            ("First-Response",   16),
            ("SLA Bucket",       12),
            ("Reopened Count",   14),
            ("Feedback Rating",  14),
            ("Feedback Comment", 36),
            ("Status Reason",    30),
            ("Messages",         10),
        ]
        extra_col_defs = [(k, max(len(k) + 4, 18)) for k in extra_keys]
        all_cols  = fixed_cols + extra_col_defs
        num_cols  = len(all_cols)
        HEADER_ROW = LOGO_ROWS + 2

        styled_header_row(ws1, HEADER_ROW, all_cols)
        ws1.freeze_panes = f"A{HEADER_ROW + 1}"
        ws1.auto_filter.ref = (
            f"A{HEADER_ROW}:{get_column_letter(num_cols)}{HEADER_ROW}"
        )

        # Pre-fetch first-response times (first staff message per ticket)
        from .models import TicketMessage, TicketEvent, TicketFeedback
        from django.db.models import Min, Count

        first_reply_qs = (
            TicketMessage.objects
            .filter(ticket_id__in=ticket_ids, is_staff_reply=True)
            .values('ticket_id')
            .annotate(first_at=Min('created_at'))
        )
        first_reply_map = {str(r['ticket_id']): r['first_at'] for r in first_reply_qs}

        # Pre-fetch reopen counts (status_changed events where new_value = 'In Progress'
        # and old_value = 'Resolved')
        reopen_qs = (
            TicketEvent.objects
            .filter(
                ticket_id__in=ticket_ids,
                action='status_changed',
                old_value__icontains='resolved',
                new_value__icontains='progress',
            )
            .values('ticket_id')
            .annotate(cnt=Count('id'))
        )
        reopen_map = {str(r['ticket_id']): r['cnt'] for r in reopen_qs}

        # Pre-fetch message counts
        msg_count_qs = (
            TicketMessage.objects
            .filter(ticket_id__in=ticket_ids)
            .values('ticket_id')
            .annotate(cnt=Count('id'))
        )
        msg_count_map = {str(r['ticket_id']): r['cnt'] for r in msg_count_qs}

        # Pre-fetch feedback
        feedback_map = {
            str(f.ticket_id): f
            for f in TicketFeedback.objects.filter(ticket_id__in=ticket_ids)
        }

        for row_offset, ticket in enumerate(tickets):
            row_num  = HEADER_ROW + 1 + row_offset
            is_alt   = (row_offset % 2 == 1)
            base_fill = alt_fill if is_alt else white_fill
            tid = str(ticket.pk)

            # Resolution time
            if ticket.status in ("resolved", "closed", "cancelled") and ticket.updated_at:
                res_td    = ticket.updated_at - ticket.created_at
                res_hours = res_td.total_seconds() / 3600
                res_str   = self._duration_str(res_td)
                sla       = self._sla_bucket(res_hours)
                res_utc   = ticket.updated_at.strftime("%Y-%m-%d %H:%M") if ticket.status in ("resolved","closed") else "—"
            else:
                age_td  = now_utc - ticket.created_at
                res_str = "—"
                sla     = self._sla_bucket(age_td.total_seconds() / 3600)
                res_utc = "—"

            age_str = self._duration_str(now_utc - ticket.created_at)

            # First-response time
            first_reply_at = first_reply_map.get(tid)
            if first_reply_at and ticket.created_at:
                frt_str = self._duration_str(first_reply_at - ticket.created_at)
            else:
                frt_str = "—"

            reopen_cnt = reopen_map.get(tid, 0)
            msg_cnt    = msg_count_map.get(tid, 0)

            feedback = feedback_map.get(tid)
            fb_rating  = feedback.rating if feedback else "—"
            fb_comment = feedback.comment if feedback else "—"

            requester_name  = ticket.requester.get_full_name() if ticket.requester else "—"
            requester_email = ticket.requester.email if ticket.requester else "—"
            assignee        = (
                ticket.assigned_to.get_full_name() or ticket.assigned_to.username
            ) if ticket.assigned_to else "Unassigned"

            row_vals = [
                ticket.reference,
                ticket.category.name if ticket.category else "—",
                ticket.subject,
                status_labels.get(ticket.status, ticket.status),
                priority_labels.get(ticket.priority, ticket.priority),
                ticket.current_stage or "—",
                requester_name,
                requester_email,
                assignee,
                ticket.team or "—",
                ticket.created_at.strftime("%Y-%m-%d %H:%M") if ticket.created_at else "—",
                ticket.updated_at.strftime("%Y-%m-%d %H:%M") if ticket.updated_at else "—",
                res_utc,
                age_str,
                res_str,
                frt_str,
                sla,
                reopen_cnt,
                fb_rating,
                fb_comment,
                ticket.status_reason or "—",
                msg_cnt,
            ]
            for k in extra_keys:
                row_vals.append(
                    str(ticket.extra_fields.get(k, "")) if ticket.extra_fields else ""
                )

            CENTER_COLS = {4, 5, 6, 11, 12, 13, 14, 15, 16, 17, 18, 19}
            for col_idx, val in enumerate(row_vals, start=1):
                cell = ws1.cell(row=row_num, column=col_idx, value=val)
                cell.fill      = base_fill
                cell.font      = normal_font
                cell.border    = border
                cell.alignment = center_align if col_idx in CENTER_COLS else left_align

            ws1.cell(row=row_num, column=4).fill = status_fills.get(ticket.status, base_fill)
            ws1.cell(row=row_num, column=5).fill = priority_fills.get(ticket.priority, base_fill)
            ws1.row_dimensions[row_num].height = 16

        # =================================================================
        # SHEET 2 — Analytics Summary
        # =================================================================

        ws2 = wb.create_sheet("Analytics Summary")
        ws2.sheet_view.showGridLines = False
        ws2.column_dimensions["A"].width = 34
        ws2.column_dimensions["B"].width = 18
        ws2.column_dimensions["C"].width = 18
        ws2.column_dimensions["D"].width = 18
        # Chart area — give columns F-S generous width
        for col_letter in ["E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S"]:
            ws2.column_dimensions[col_letter].width = 10

        write_sheet_logo(ws2, "A1")

        section_fill   = PatternFill("solid", fgColor="234395")
        section_font   = Font(bold=True, color="FFFFFF", size=11, name="Calibri")
        kpi_label_font = Font(bold=True, size=10, color="334155", name="Calibri")
        sub_fill       = PatternFill("solid", fgColor="EEF2FF")
        sub_font       = Font(bold=True, size=9, color="234395", name="Calibri")

        a2_row = [1, 2, 3, 4, 5]   # mutable via list so nested fns can close over it
        row2   = [LOGO_ROWS + 2]

        # Chart placement cursor — charts stack vertically in column F
        chart_row = [2]   # start near top; incremented after each chart

        def row_():
            return row2[0]

        def inc_():
            row2[0] += 1

        ws2.merge_cells(f"A{row_()}:D{row_()}")
        ws2[f"A{row_()}"].value = "IIC IT Helpdesk — Analytics Summary"
        ws2[f"A{row_()}"].font  = Font(bold=True, size=14, color="234395", name="Calibri")
        ws2[f"A{row_()}"].alignment = Alignment(horizontal="left", vertical="center")
        ws2.row_dimensions[row_()].height = 26
        inc_()

        ws2.merge_cells(f"A{row_()}:D{row_()}")
        ws2.cell(row=row_(), column=1, value=f"Generated: {iso_now}    Total tickets: {len(tickets)}").font = Font(size=9, italic=True, color="64748B", name="Calibri")
        inc_()
        inc_()

        def section_header2(title: str):
            ws2.merge_cells(f"A{row_()}:D{row_()}")
            cell = ws2.cell(row=row_(), column=1, value=title)
            cell.fill      = section_fill
            cell.font      = section_font
            cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws2.row_dimensions[row_()].height = 24
            inc_()

        def write_kv2(label: str, value, bold_val: bool = True):
            lc = ws2.cell(row=row_(), column=1, value=label)
            lc.font = kpi_label_font
            vc = ws2.cell(row=row_(), column=2, value=value)
            vc.font = Font(bold=bold_val, size=10, name="Calibri")
            vc.alignment = Alignment(horizontal="right")
            ws2.row_dimensions[row_()].height = 16
            inc_()

        def write_table2(header: list[str], rows_data: list[tuple], fills=None):
            """Write a styled table and return (label_col, data_start_row, data_end_row)."""
            for ci, h in enumerate(header, start=1):
                c = ws2.cell(row=row_(), column=ci, value=h)
                c.fill      = sub_fill
                c.font      = sub_font
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.border    = border
            ws2.row_dimensions[row_()].height = 18
            inc_()
            data_start = row_()
            for ri, data_row in enumerate(rows_data):
                f = fills[ri] if fills and ri < len(fills) else (alt_fill if ri % 2 else white_fill)
                for ci, val in enumerate(data_row, start=1):
                    c = ws2.cell(row=row_(), column=ci, value=val)
                    c.fill      = f or (alt_fill if ri % 2 else white_fill)
                    c.font      = normal_font
                    c.border    = border
                    c.alignment = Alignment(horizontal="right" if ci > 1 else "left")
                ws2.row_dimensions[row_()].height = 15
                inc_()
            data_end = row_() - 1
            inc_()  # blank spacer
            return data_start, data_end

        # ── Chart helper ──────────────────────────────────────────────────
        from openpyxl.chart import BarChart, PieChart, LineChart, Reference
        from openpyxl.chart.series import DataPoint
        from openpyxl.chart.label import DataLabelList

        CHART_W = 14    # columns wide  (~430px)
        CHART_H = 15    # rows tall     (~280px)

        # Palette for bar/line series (brand colours)
        CHART_COLORS = [
            "234395","3B82F6","10B981","F59E0B","EF4444",
            "8B5CF6","EC4899","14B8A6","F97316","6366F1",
        ]

        def place_chart(chart, title: str):
            """Set chart title and place it in the chart column, advancing cursor."""
            chart.title  = title
            chart.style  = 10
            chart.width  = CHART_W * 6.4     # EMU approximation openpyxl uses cm
            chart.height = CHART_H * 0.525
            ws2.add_chart(chart, f"F{chart_row[0]}")
            chart_row[0] += CHART_H + 1

        def _data_labels():
            dl = DataLabelList()
            dl.showVal     = True
            dl.showPercent = False
            dl.showLegendKey = False
            dl.showSerName = False
            dl.showCatName = False
            return dl

        total         = len(tickets)
        open_count    = sum(1 for t in tickets if t.status not in ("resolved","closed","cancelled"))
        resolved_cnt  = sum(1 for t in tickets if t.status == "resolved")
        closed_cnt    = sum(1 for t in tickets if t.status == "closed")
        cancelled_cnt = sum(1 for t in tickets if t.status == "cancelled")
        critical_cnt  = sum(1 for t in tickets if t.priority == "p1")
        unassigned    = sum(1 for t in tickets if not t.assigned_to and t.status not in ("closed","cancelled"))

        res_times = []
        frt_list  = []
        for t in tickets:
            tid = str(t.pk)
            if t.status in ("resolved","closed") and t.updated_at and t.created_at:
                res_times.append((t.updated_at - t.created_at).total_seconds() / 3600)
            fr = first_reply_map.get(tid)
            if fr and t.created_at:
                frt_list.append((fr - t.created_at).total_seconds() / 3600)

        avg_res = (sum(res_times) / len(res_times)) if res_times else None
        avg_frt = (sum(frt_list)  / len(frt_list))  if frt_list  else None

        section_header2("Key Performance Indicators")
        write_kv2("Total tickets in export",     total)
        write_kv2("Open tickets",                open_count)
        write_kv2("Resolved",                    resolved_cnt)
        write_kv2("Closed (confirmed)",          closed_cnt)
        write_kv2("Cancelled",                   cancelled_cnt)
        write_kv2("Critical (P1) tickets",       critical_cnt)
        write_kv2("Unassigned & open",           unassigned)
        write_kv2("Avg resolution time",         f"{avg_res:.1f}h" if avg_res is not None else "—")
        write_kv2("Avg first-response time",     f"{avg_frt:.1f}h" if avg_frt is not None else "—")
        total_reopens = sum(reopen_map.values())
        write_kv2("Total ticket re-opens",       total_reopens)
        fb_all     = list(feedback_map.values())
        avg_rating = round(sum(f.rating for f in fb_all) / len(fb_all), 2) if fb_all else "—"
        write_kv2("Avg satisfaction rating",     f"{avg_rating} / 5" if fb_all else "—")
        inc_()

        # ── Status table + PIE chart ──────────────────────────────────────
        section_header2("Tickets by Status")
        status_counts = Counter(t.status for t in tickets)
        status_rows   = sorted(status_counts.items(), key=lambda x: -x[1])
        s_start, s_end = write_table2(
            ["Status", "Count", "% of Total"],
            [(status_labels.get(s, s), c, f"{c/total*100:.1f}%" if total else "—")
             for s, c in status_rows],
            fills=[status_fills.get(s) for s, _ in status_rows],
        )
        if s_start <= s_end:
            pc = PieChart()
            pc.dLbls = _data_labels()
            pc.dLbls.showPercent = True
            pc.dLbls.showVal     = False
            labels = Reference(ws2, min_col=1, min_row=s_start, max_row=s_end)
            data   = Reference(ws2, min_col=2, min_row=s_start, max_row=s_end)
            pc.add_data(data)
            pc.set_categories(labels)
            place_chart(pc, "Tickets by Status")

        # ── Priority table + PIE chart ────────────────────────────────────
        section_header2("Tickets by Priority")
        prio_counts = Counter(t.priority for t in tickets)
        prio_rows   = sorted(prio_counts.items())
        p_start, p_end = write_table2(
            ["Priority", "Count", "% of Total"],
            [(priority_labels.get(p, p), c, f"{c/total*100:.1f}%" if total else "—")
             for p, c in prio_rows],
            fills=[priority_fills.get(p) for p, _ in prio_rows],
        )
        if p_start <= p_end:
            pc2 = PieChart()
            pc2.dLbls = _data_labels()
            pc2.dLbls.showPercent = True
            pc2.dLbls.showVal     = False
            labels2 = Reference(ws2, min_col=1, min_row=p_start, max_row=p_end)
            data2   = Reference(ws2, min_col=2, min_row=p_start, max_row=p_end)
            pc2.add_data(data2)
            pc2.set_categories(labels2)
            place_chart(pc2, "Tickets by Priority")

        # ── Category table + BAR chart ────────────────────────────────────
        section_header2("Tickets by Service Category")
        cat_counts = Counter(
            (t.category.name if t.category else "Unknown") for t in tickets
        )
        cat_rows = sorted(cat_counts.items(), key=lambda x: -x[1])
        c_start, c_end = write_table2(
            ["Category", "Count", "% of Total"],
            [(cat, c, f"{c/total*100:.1f}%" if total else "—")
             for cat, c in cat_rows],
        )
        if c_start <= c_end:
            bc = BarChart()
            bc.type    = "bar"    # horizontal
            bc.barDir  = "bar"
            bc.grouping = "clustered"
            bc.dLbls   = _data_labels()
            bc_labels  = Reference(ws2, min_col=1, min_row=c_start, max_row=c_end)
            bc_data    = Reference(ws2, min_col=2, min_row=c_start - 1, max_row=c_end)
            bc.add_data(bc_data, titles_from_data=True)
            bc.set_categories(bc_labels)
            bc.series[0].graphicalProperties.solidFill = CHART_COLORS[0]
            place_chart(bc, "Tickets by Service Category")

        # ── SLA table + BAR chart ─────────────────────────────────────────
        section_header2("SLA Bucket Distribution (Time to Resolve / Current Age)")
        sla_buckets: Counter[str] = Counter()
        for t in tickets:
            if t.status in ("resolved","closed") and t.updated_at and t.created_at:
                h = (t.updated_at - t.created_at).total_seconds() / 3600
            else:
                h = (now_utc - t.created_at).total_seconds() / 3600
            sla_buckets[self._sla_bucket(h)] += 1
        bucket_order = ["= 4h","= 8h","= 24h","= 3d","= 7d","> 7d"]
        sla_rows = [(b, sla_buckets[b], f"{sla_buckets[b]/total*100:.1f}%" if total else "—")
                    for b in bucket_order if sla_buckets[b] > 0]
        sla_start, sla_end = write_table2(["SLA Bucket", "Count", "% of Total"], sla_rows)
        if sla_start <= sla_end:
            bc2 = BarChart()
            bc2.type    = "col"
            bc2.barDir  = "col"
            bc2.grouping = "clustered"
            bc2.dLbls   = _data_labels()
            sla_labels  = Reference(ws2, min_col=1, min_row=sla_start, max_row=sla_end)
            sla_data    = Reference(ws2, min_col=2, min_row=sla_start - 1, max_row=sla_end)
            bc2.add_data(sla_data, titles_from_data=True)
            bc2.set_categories(sla_labels)
            bc2.series[0].graphicalProperties.solidFill = CHART_COLORS[1]
            place_chart(bc2, "SLA Bucket Distribution")

        # ── Assignee workload table + BAR chart ───────────────────────────
        section_header2("Assignee Workload")
        assignee_counts: Counter[str] = Counter()
        open_by_assignee: Counter[str] = Counter()
        for t in tickets:
            name = (
                t.assigned_to.get_full_name() or t.assigned_to.username
            ) if t.assigned_to else "Unassigned"
            assignee_counts[name] += 1
            if t.status not in ("resolved","closed","cancelled"):
                open_by_assignee[name] += 1
        asgn_rows = [(a, assignee_counts[a], open_by_assignee.get(a, 0))
                     for a in sorted(assignee_counts, key=lambda x: -assignee_counts[x])]
        asgn_start, asgn_end = write_table2(["Assignee", "Total", "Open"], asgn_rows)
        if asgn_start <= asgn_end:
            bc3 = BarChart()
            bc3.type     = "bar"
            bc3.barDir   = "bar"
            bc3.grouping = "clustered"
            bc3.dLbls    = _data_labels()
            asgn_labels  = Reference(ws2, min_col=1, min_row=asgn_start, max_row=asgn_end)
            asgn_data    = Reference(ws2, min_col=2, min_row=asgn_start - 1, max_row=asgn_end, max_col=3)
            bc3.add_data(asgn_data, titles_from_data=True)
            bc3.set_categories(asgn_labels)
            bc3.series[0].graphicalProperties.solidFill = CHART_COLORS[0]
            bc3.series[1].graphicalProperties.solidFill = CHART_COLORS[2]
            place_chart(bc3, "Assignee Workload (Total vs Open)")

        # ── Satisfaction ratings table + BAR chart ────────────────────────
        section_header2("Satisfaction Ratings")
        if fb_all:
            rating_counts = Counter(f.rating for f in fb_all)
            rating_labels = {1:"Very dissatisfied",2:"Dissatisfied",3:"Neutral",4:"Satisfied",5:"Very satisfied"}
            rat_rows = [(r, rating_labels.get(r,""), rating_counts.get(r,0),
                         f"{rating_counts.get(r,0)/len(fb_all)*100:.1f}%")
                        for r in range(1, 6)]
            rat_start, rat_end = write_table2(
                ["Rating", "Label", "Count", "% of Responses"], rat_rows)
            if rat_start <= rat_end:
                bc4 = BarChart()
                bc4.type     = "col"
                bc4.barDir   = "col"
                bc4.grouping = "clustered"
                bc4.dLbls    = _data_labels()
                rat_labels_ref = Reference(ws2, min_col=2, min_row=rat_start, max_row=rat_end)
                rat_data_ref   = Reference(ws2, min_col=3, min_row=rat_start - 1, max_row=rat_end)
                bc4.add_data(rat_data_ref, titles_from_data=True)
                bc4.set_categories(rat_labels_ref)
                bc4.series[0].graphicalProperties.solidFill = CHART_COLORS[4]
                place_chart(bc4, "Satisfaction Rating Distribution")
        else:
            write_kv2("No feedback submitted yet", "—", bold_val=False)
            inc_()

        # ── Day of week table (no chart — small) ──────────────────────────
        section_header2("Submissions by Day of Week")
        dow_labels_list = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
        dow_counts: Counter[int] = Counter(t.created_at.weekday() for t in tickets if t.created_at)
        dow_rows = [(dow_labels_list[d], dow_counts[d]) for d in range(7)]
        dow_start, dow_end = write_table2(["Day", "Count"], dow_rows)
        if dow_start <= dow_end:
            bc5 = BarChart()
            bc5.type     = "col"
            bc5.barDir   = "col"
            bc5.grouping = "clustered"
            bc5.dLbls    = _data_labels()
            dow_labels_ref = Reference(ws2, min_col=1, min_row=dow_start, max_row=dow_end)
            dow_data_ref   = Reference(ws2, min_col=2, min_row=dow_start - 1, max_row=dow_end)
            bc5.add_data(dow_data_ref, titles_from_data=True)
            bc5.set_categories(dow_labels_ref)
            bc5.series[0].graphicalProperties.solidFill = CHART_COLORS[5]
            place_chart(bc5, "Submissions by Day of Week")

        # ── Monthly volume table + LINE chart ─────────────────────────────
        section_header2("Submissions by Month")
        month_counts: Counter[str] = Counter(
            t.created_at.strftime("%Y-%m") for t in tickets if t.created_at
        )
        month_rows = [(m, c) for m, c in sorted(month_counts.items())]
        mo_start, mo_end = write_table2(["Month", "Count"], month_rows)
        if mo_start <= mo_end:
            lc2 = LineChart()
            lc2.grouping = "standard"
            lc2.smooth   = True
            lc2.dLbls    = _data_labels()
            mo_labels = Reference(ws2, min_col=1, min_row=mo_start, max_row=mo_end)
            mo_data   = Reference(ws2, min_col=2, min_row=mo_start - 1, max_row=mo_end)
            lc2.add_data(mo_data, titles_from_data=True)
            lc2.set_categories(mo_labels)
            lc2.series[0].graphicalProperties.line.solidFill = CHART_COLORS[0]
            place_chart(lc2, "Ticket Volume by Month")

        # =================================================================
        # SHEET 3 — Ticket Audit Trail
        # =================================================================

        ws3 = wb.create_sheet("Ticket Audit Trail")
        ws3.sheet_view.showGridLines = True

        write_sheet_logo(ws3, "A1")

        ws3.merge_cells(f"D1:J1")
        ws3["D1"].value = "IIC IT Helpdesk — Ticket Audit Trail"
        ws3["D1"].font  = Font(bold=True, size=13, color="234395", name="Calibri")
        ws3["D1"].alignment = Alignment(horizontal="left", vertical="center")

        ws3.merge_cells(f"D2:J2")
        ws3["D2"].value = f"Generated: {iso_now}    Scope: {len(tickets)} ticket(s)"
        ws3["D2"].font  = Font(size=9, italic=True, color="64748B", name="Calibri")

        AUDIT_HEADER_ROW = LOGO_ROWS + 2
        audit_cols: list[tuple[str, int]] = [
            ("#",             5),
            ("Timestamp (UTC)", 22),
            ("Ticket Ref",    14),
            ("Category",      22),
            ("Action",        22),
            ("Actor",         24),
            ("Actor Role",    20),
            ("From",          22),
            ("To",            22),
            ("Note / Reason", 40),
        ]
        styled_header_row(ws3, AUDIT_HEADER_ROW, audit_cols)
        ws3.freeze_panes = f"A{AUDIT_HEADER_ROW + 1}"
        ws3.auto_filter.ref = (
            f"A{AUDIT_HEADER_ROW}:{get_column_letter(len(audit_cols))}{AUDIT_HEADER_ROW}"
        )

        # Fetch all events for the exported tickets in one query
        from .models import RoleGrant
        events_qs = (
            TicketEvent.objects
            .filter(ticket_id__in=ticket_ids)
            .select_related('ticket', 'ticket__category', 'actor')
            .order_by('created_at')
        )

        # Build actor → highest role map for display
        from django.contrib.auth import get_user_model
        User = get_user_model()
        actor_ids = {e.actor_id for e in events_qs if e.actor_id}
        from django.utils import timezone as tz2
        now_tz = tz2.now()
        active_grants = (
            RoleGrant.objects
            .filter(user_id__in=actor_ids)
            .filter(
                Q(expires_at__isnull=True) | Q(expires_at__gt=now_tz)
            )
            .values('user_id', 'role')
        )
        ROLE_ORDER = ["administrator","service_lead","it_agent","it_noc_intern",
                      "designated_approver","content_editor","faculty_staff","student","visitor"]
        actor_role_map: dict = {}
        for g in active_grants:
            uid = g['user_id']
            if uid not in actor_role_map:
                actor_role_map[uid] = g['role']
            else:
                # Keep highest role
                curr_idx = ROLE_ORDER.index(actor_role_map[uid]) if actor_role_map[uid] in ROLE_ORDER else 99
                new_idx  = ROLE_ORDER.index(g['role']) if g['role'] in ROLE_ORDER else 99
                if new_idx < curr_idx:
                    actor_role_map[uid] = g['role']

        ticket_ref_map = {str(t.pk): t for t in tickets}

        for seq, evt in enumerate(events_qs, start=1):
            row_num = AUDIT_HEADER_ROW + seq
            is_alt  = seq % 2 == 1
            af      = action_fills.get(evt.action, alt_fill if is_alt else white_fill)

            actor_name = "System"
            actor_role = "—"
            if evt.actor:
                actor_name = evt.actor.get_full_name() or evt.actor.username
                actor_role = actor_role_map.get(evt.actor_id, "—").replace("_", " ").title()

            t_ref = evt.ticket.reference if evt.ticket else "—"
            t_cat = evt.ticket.category.name if (evt.ticket and evt.ticket.category) else "—"

            row_vals = [
                seq,
                evt.created_at.strftime("%Y-%m-%d %H:%M:%S") if evt.created_at else "—",
                t_ref,
                t_cat,
                action_labels.get(evt.action, evt.action),
                actor_name,
                actor_role,
                evt.old_value or "—",
                evt.new_value or "—",
                evt.note      or "—",
            ]
            for col_idx, val in enumerate(row_vals, start=1):
                cell = ws3.cell(row=row_num, column=col_idx, value=val)
                cell.fill   = af
                cell.font   = normal_font
                cell.border = border
                cell.alignment = center_align if col_idx in (1, 2, 5, 6, 7) else left_align
            ws3.row_dimensions[row_num].height = 15

        if not list(events_qs):
            ws3.cell(row=AUDIT_HEADER_ROW + 1, column=1,
                     value="No audit events recorded for these tickets.").font = Font(
                italic=True, color="94A3B8", name="Calibri", size=10)

        # =================================================================
        # SHEET 4 — Role Audit Events
        # =================================================================

        from .models import RoleAuditEvent

        ws4 = wb.create_sheet("Role Audit Events")
        ws4.sheet_view.showGridLines = True

        write_sheet_logo(ws4, "A1")

        ws4.merge_cells(f"D1:J1")
        ws4["D1"].value = "IIC IT Helpdesk — Role Grant / Revocation Audit"
        ws4["D1"].font  = Font(bold=True, size=13, color="234395", name="Calibri")
        ws4["D1"].alignment = Alignment(horizontal="left", vertical="center")

        ws4.merge_cells(f"D2:J2")
        ws4["D2"].value = (
            f"Generated: {iso_now}    "
            "All-time role audit log (not filtered by ticket date range)"
        )
        ws4["D2"].font = Font(size=9, italic=True, color="64748B", name="Calibri")

        ROLE_HEADER_ROW = LOGO_ROWS + 2
        role_cols: list[tuple[str, int]] = [
            ("#",               5),
            ("Timestamp (UTC)", 22),
            ("Action",          12),
            ("Role",            22),
            ("Target User",     26),
            ("Target Email",    30),
            ("Target Dept.",    22),
            ("Performed By",    26),
            ("Performer Email", 30),
            ("Performer Role",  22),
        ]
        styled_header_row(ws4, ROLE_HEADER_ROW, role_cols)
        ws4.freeze_panes = f"A{ROLE_HEADER_ROW + 1}"
        ws4.auto_filter.ref = (
            f"A{ROLE_HEADER_ROW}:{get_column_letter(len(role_cols))}{ROLE_HEADER_ROW}"
        )

        role_events_qs = (
            RoleAuditEvent.objects
            .select_related('actor', 'target')
            .order_by('-timestamp')
        )

        # Fetch UserProfile for dept info
        from .models import UserProfile
        profile_ids = set()
        role_event_list = list(role_events_qs)
        for re in role_event_list:
            if re.target_id: profile_ids.add(re.target_id)
            if re.actor_id:  profile_ids.add(re.actor_id)
        profiles = {
            p.user_id: p
            for p in UserProfile.objects.filter(user_id__in=profile_ids)
        }

        for seq, re in enumerate(role_event_list, start=1):
            row_num  = ROLE_HEADER_ROW + seq
            rf       = role_action_fills.get(re.action, white_fill)

            target_name  = (re.target.get_full_name() or re.target.username) if re.target else "—"
            target_email = re.target.email if re.target else "—"
            target_prof  = profiles.get(re.target_id)
            target_dept  = (target_prof.department or "—") if target_prof else "—"

            actor_name   = (re.actor.get_full_name() or re.actor.username) if re.actor else "System"
            actor_email  = re.actor.email if re.actor else "—"
            actor_r      = actor_role_map.get(re.actor_id, "—").replace("_", " ").title() if re.actor_id else "—"

            row_vals = [
                seq,
                re.timestamp.strftime("%Y-%m-%d %H:%M:%S") if re.timestamp else "—",
                re.action.capitalize(),
                re.role.replace("_", " ").title(),
                target_name,
                target_email,
                target_dept,
                actor_name,
                actor_email,
                actor_r,
            ]
            for col_idx, val in enumerate(row_vals, start=1):
                cell = ws4.cell(row=row_num, column=col_idx, value=val)
                cell.fill   = rf
                cell.font   = normal_font
                cell.border = border
                cell.alignment = center_align if col_idx in (1, 2, 3, 4) else left_align
            ws4.row_dimensions[row_num].height = 15

        if not role_event_list:
            ws4.cell(row=ROLE_HEADER_ROW + 1, column=1,
                     value="No role audit events recorded.").font = Font(
                italic=True, color="94A3B8", name="Calibri", size=10)

        return wb

    # -- GET handler -----------------------------------------------------------

    def get(self, request):
        import io
        from django.http import HttpResponse
        from django.utils import timezone as tz

        # -- Permission check ----------------------------------------------
        if not self._check_export_permission(request):
            return Response(
                {'detail': 'Your role does not have permission to export ticket reports.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # -- Build queryset with optional filters --------------------------
        qs = Ticket.objects.select_related(
            'category', 'requester', 'assigned_to'
        ).order_by('created_at')

        # Status filter
        status_param = request.query_params.get('status', '')
        if status_param:
            qs = qs.filter(status__in=[s.strip() for s in status_param.split(',')])

        # Priority filter
        priority_param = request.query_params.get('priority', '')
        if priority_param:
            qs = qs.filter(priority__in=[p.strip() for p in priority_param.split(',')])

        # Category slug filter
        category_param = request.query_params.get('category', '')
        if category_param:
            qs = qs.filter(category__slug__in=[c.strip() for c in category_param.split(',')])

        # Date range
        from_dt = self._parse_date(request.query_params.get('from'))
        to_dt   = self._parse_date(request.query_params.get('to'))
        if from_dt:
            qs = qs.filter(created_at__gte=from_dt)
        if to_dt:
            from datetime import timedelta
            # End of the 'to' day
            qs = qs.filter(created_at__lt=to_dt + timedelta(days=1))

        # Intern scope restriction
        from .permissions import get_user_roles, user_has_intern_scope_only, get_intern_scope_slugs
        roles = get_user_roles(request.user)
        if not request.user.is_superuser and user_has_intern_scope_only(request.user):
            qs = qs.filter(category__slug__in=get_intern_scope_slugs())

        tickets = list(qs)

        if not tickets:
            return Response({'detail': 'No tickets match the selected filters.'}, status=status.HTTP_204_NO_CONTENT)

        # -- Build Excel --------------------------------------------------
        wb = self._build_workbook(tickets)

        # -- Return as streaming response ----------------------------------
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        now_label = tz.now().strftime("%Y%m%d_%H%M")
        filename  = f"IIC_Helpdesk_Ticket_Report_{now_label}.xlsx"

        response = HttpResponse(
            buf.read(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["X-Report-Tickets"]    = str(len(tickets))
        response["X-Report-Generated"]  = tz.now().isoformat()
        return response


# ---------------------------------------------------------------------------
# Server-Sent Events (SSE) — real-time ticket updates
# ---------------------------------------------------------------------------

def _sse_format(event: str, data: str) -> str:
    """Format a single SSE frame."""
    return f"event: {event}\ndata: {data}\n\n"


def _sse_heartbeat() -> str:
    return ": heartbeat\n\n"


class TicketStreamView(View):
    """
    GET /api/v1/tickets/{pk}/stream/

    Plain Django View (NOT a DRF APIView) so that DRF content negotiation
    never intercepts the text/event-stream Accept header.

    Streams Server-Sent Events for a single ticket. The client receives:
      event: connected     - initial snapshot
      event: ticket_update - whenever ticket fields change
      event: new_message   - whenever a new TicketMessage is saved
      event: error         - ticket not found or access denied

    Polls the DB every ~1.5 s. Run Django with a threaded worker
    (gunicorn --worker-class gthread or dev runserver) so long-lived
    streaming connections do not block other requests.
    """

    def get(self, request, pk):
        import json as _json
        import time
        from uuid import UUID
        from django.http import StreamingHttpResponse

        # Auth: plain Django session - already populated by SessionMiddleware.
        # No DRF authentication pipeline runs here, so we check directly.
        if not request.user or not request.user.is_authenticated:
            def _unauth():
                yield _sse_format("error", _json.dumps({"detail": "Authentication required."}))
            r = StreamingHttpResponse(_unauth(), content_type="text/event-stream")
            r["Cache-Control"] = "no-cache"
            r["X-Accel-Buffering"] = "no"
            return r

        # -- Resolve ticket + access check --------------------------------
        from .permissions import get_user_roles, user_has_intern_scope_only, get_intern_scope_slugs

        try:
            ticket_pk = UUID(pk)
            ticket = Ticket.objects.select_related("category", "requester", "assigned_to").get(pk=ticket_pk)
        except (Ticket.DoesNotExist, ValueError):
            def _notfound():
                yield _sse_format("error", _json.dumps({"detail": "Ticket not found."}))
            r = StreamingHttpResponse(_notfound(), content_type="text/event-stream")
            r["Cache-Control"] = "no-cache"
            r["X-Accel-Buffering"] = "no"
            return r

        roles = get_user_roles(request.user)
        staff_roles = {"administrator", "service_lead", "it_agent", "it_noc_intern",
                       "content_editor", "designated_approver"}
        is_staff = request.user.is_superuser or bool(roles.intersection(staff_roles))

        if is_staff:
            if not request.user.is_superuser and user_has_intern_scope_only(request.user):
                if ticket.category and ticket.category.slug not in get_intern_scope_slugs():
                    def _forbidden():
                        yield _sse_format("error", _json.dumps({"detail": "Access denied."}))
                    r = StreamingHttpResponse(_forbidden(), content_type="text/event-stream")
                    r["Cache-Control"] = "no-cache"
                    r["X-Accel-Buffering"] = "no"
                    return r
        else:
            if ticket.requester_id != request.user.pk:
                def _forbidden2():
                    yield _sse_format("error", _json.dumps({"detail": "Access denied."}))
                r = StreamingHttpResponse(_forbidden2(), content_type="text/event-stream")
                r["Cache-Control"] = "no-cache"
                r["X-Accel-Buffering"] = "no"
                return r

        # -- Serialise helpers -------------------------------------------

        def _ticket_snapshot(t):
            return {
                "id":            str(t.pk),
                "status":        t.status,
                "priority":      t.priority,
                "current_stage": t.current_stage,
                "subject":       t.subject,
                "assignee_name": (t.assigned_to.get_full_name() or t.assigned_to.username)
                                  if t.assigned_to else None,
                "team":          t.team,
                "updated_at":    t.updated_at.isoformat() if t.updated_at else None,
            }

        def _message_dict(m, is_staff_viewer):
            if m.is_internal and not is_staff_viewer:
                return None
            return {
                "id":             m.id,
                "sender":         m.sender_id,
                "sender_name":    (m.sender.get_full_name() or m.sender.username) if m.sender else None,
                "sender_email":   m.sender.email if m.sender else None,
                "body":           m.body,
                "is_staff_reply": m.is_staff_reply,
                "is_internal":    m.is_internal,
                "created_at":     m.created_at.isoformat(),
            }

        # -- Generator ---------------------------------------------------

        def event_stream():
            last_snapshot = _ticket_snapshot(ticket)
            last_message_id = (
                TicketMessage.objects.filter(ticket=ticket)
                .order_by("-created_at")
                .values_list("id", flat=True)
                .first() or 0
            )

            yield _sse_format("connected", _json.dumps({
                "ticket":    last_snapshot,
                "ticket_id": str(ticket.pk),
            }))

            heartbeat_counter = 0
            while True:
                time.sleep(1.5)

                heartbeat_counter += 1
                if heartbeat_counter % 10 == 0:
                    yield _sse_heartbeat()

                try:
                    t = Ticket.objects.select_related("assigned_to").get(pk=ticket_pk)
                except Ticket.DoesNotExist:
                    yield _sse_format("error", _json.dumps({"detail": "Ticket deleted."}))
                    return

                current_snapshot = _ticket_snapshot(t)
                if current_snapshot != last_snapshot:
                    last_snapshot = current_snapshot
                    yield _sse_format("ticket_update", _json.dumps(current_snapshot))

                new_msgs = (
                    TicketMessage.objects
                    .filter(ticket_id=ticket_pk, id__gt=last_message_id)
                    .select_related("sender")
                    .order_by("id")
                )
                for msg in new_msgs:
                    payload = _message_dict(msg, is_staff)
                    if payload:
                        yield _sse_format("new_message", _json.dumps(payload))
                    last_message_id = msg.id

        response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
        response["Cache-Control"]     = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

        return response


# ---------------------------------------------------------------------------
# Announcement views
# ---------------------------------------------------------------------------

class ActiveAnnouncementView(APIView):
    """
    GET /api/v1/announcement/

    Public endpoint — no auth required. Returns the single most-recently-
    updated active announcement, or 204 No Content if none is active.
    """
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)

    def get(self, request):
        from django.utils import timezone as _tz
        now = _tz.now()
        ann = (
            Announcement.objects
            .filter(is_active=True)
            .filter(
                Q(scheduled_start__isnull=True) | Q(scheduled_start__lte=now)
            )
            .filter(
                Q(scheduled_end__isnull=True) | Q(scheduled_end__gt=now)
            )
            .order_by('-priority', '-updated_at')
            .first()
        )
        if ann is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(AnnouncementSerializer(ann, context={'request': request}).data)


class AdminAnnouncementListCreate(generics.ListCreateAPIView):
    """
    GET  /api/v1/admin/announcements/  — list all (admin only)
    POST /api/v1/admin/announcements/  — create new (admin only)
    """
    permission_classes = (IsAdministrator,)
    serializer_class = AnnouncementAdminSerializer
    pagination_class = None
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get_queryset(self):
        return Announcement.objects.all()


class AdminAnnouncementDetail(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/v1/admin/announcements/{pk}/
    PATCH  /api/v1/admin/announcements/{pk}/
    DELETE /api/v1/admin/announcements/{pk}/
    """
    permission_classes = (IsAdministrator,)
    serializer_class = AnnouncementAdminSerializer
    parser_classes = (MultiPartParser, FormParser, JSONParser)
    queryset = Announcement.objects.all()
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        """
        When activating an announcement, automatically deactivate all others
        so only one is ever active at a time.
        """
        response = super().partial_update(request, *args, **kwargs)
        if request.data.get('is_active'):
            pk = self.get_object().pk
            Announcement.objects.exclude(pk=pk).update(is_active=False)
        return response


# ---------------------------------------------------------------------------
# Account suspension
# ---------------------------------------------------------------------------

class SuspendUserView(APIView):
    """
    POST /api/v1/admin/users/{pk}/suspend/
         { "suspend": true/false, "reason": "optional text" }

    Suspends or unsuspends a user account.

    Rules:
    - Only administrators may call this endpoint.
    - An administrator cannot suspend their own account.
    - Suspending sets is_active=False on the User and is_suspended=True on the
      UserProfile (creating a profile row if one does not exist yet).
    - Unsuspending sets is_active=True and is_suspended=False and clears the
      suspension_reason.
    """
    permission_classes = (IsAdministrator,)

    def post(self, request, pk):
        from .models import UserProfile
        from django.contrib.sessions.models import Session
        from django.utils import timezone as tz

        User = get_user_model()
        try:
            target = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Self-suspension guard
        if target.pk == request.user.pk:
            return Response(
                {'code': 'self_suspend_denied', 'detail': 'You cannot suspend your own account.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Role guard — administrators cannot be suspended by another administrator
        # (only a superuser can suspend another administrator)
        from .permissions import get_user_roles
        target_roles = get_user_roles(target)
        if 'administrator' in target_roles and not request.user.is_superuser:
            return Response(
                {'code': 'cannot_suspend_admin',
                 'detail': 'Only a superuser can suspend another administrator.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        suspend = bool(request.data.get('suspend', True))
        reason  = str(request.data.get('reason', '')).strip()[:500]

        with transaction.atomic():
            # Get or create the UserProfile
            profile, _ = UserProfile.objects.get_or_create(user=target)

            if suspend:
                target.is_active        = False
                profile.is_suspended    = True
                profile.suspension_reason = reason
            else:
                target.is_active        = True
                profile.is_suspended    = False
                profile.suspension_reason = ''

            target.save(update_fields=['is_active'])
            profile.save(update_fields=['is_suspended', 'suspension_reason'])

            # If suspending, invalidate all active sessions for this user
            # so they are immediately logged out.
            if suspend:
                try:
                    # Django database session backend stores user id in _auth_user_id
                    from importlib import import_module
                    from django.conf import settings as _settings
                    engine = import_module(_settings.SESSION_ENGINE)
                    store  = engine.SessionStore
                    now    = tz.now()
                    for session in Session.objects.filter(expire_date__gt=now):
                        data = session.get_decoded()
                        if str(data.get('_auth_user_id')) == str(target.pk):
                            session.delete()
                except Exception:
                    pass  # session invalidation is best-effort

        action = 'suspended' if suspend else 'unsuspended'
        return Response({
            'detail': f'Account {action} successfully.',
            'is_suspended': profile.is_suspended,
            'suspension_reason': profile.suspension_reason,
            'is_active': target.is_active,
        })


# ---------------------------------------------------------------------------
# User deletion
# ---------------------------------------------------------------------------

class DeleteUserView(APIView):
    """
    DELETE /api/v1/admin/users/{pk}/delete/

    Permanently removes a user account and all related data (tickets,
    role grants, profile, session data).

    Guards:
    - Cannot delete your own account.
    - Cannot delete another administrator unless you are a superuser.
    - Only administrators (IsAdministrator) may call this endpoint.
    """
    permission_classes = (IsAdministrator,)

    def delete(self, request, pk):
        from .models import RoleAuditEvent
        from django.contrib.sessions.models import Session
        from django.utils import timezone as tz

        User = get_user_model()
        try:
            target = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Self-delete guard
        if target.pk == request.user.pk:
            return Response(
                {'code': 'self_delete_denied', 'detail': 'You cannot delete your own account.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Administrator guard — only a superuser can delete another administrator
        from .permissions import get_user_roles
        target_roles = get_user_roles(target)
        if 'administrator' in target_roles and not request.user.is_superuser:
            return Response(
                {'code': 'cannot_delete_admin',
                 'detail': 'Only a superuser can delete another administrator.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Invalidate all sessions belonging to the target user before deletion
        try:
            now = tz.now()
            for session in Session.objects.filter(expire_date__gt=now):
                data = session.get_decoded()
                if str(data.get('_auth_user_id')) == str(target.pk):
                    session.delete()
        except Exception:
            pass  # best-effort

        # Log the deletion as a role audit event for each active role
        try:
            for role in target_roles:
                RoleAuditEvent.objects.create(
                    actor=request.user,
                    target=target,
                    role=role,
                    action=RoleAuditEvent.ACTION_REVOKED,
                )
        except Exception:
            pass

        target_name = target.get_full_name() or target.username
        with transaction.atomic():
            target.delete()

        return Response(
            {'detail': f'Account for {target_name} has been permanently deleted.'},
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Django backend access — superuser-only toggle
# ---------------------------------------------------------------------------

class SetSuperuserView(APIView):
    """
    PATCH /api/v1/admin/users/{pk}/set-superuser/
          { "is_superuser": true | false }

    Grants or revokes Django backend (is_superuser) access for a user.

    Rules
    ─────
    - Only a request from a user who is themselves a superuser may call this.
      Application-only administrators (is_superuser=False) are blocked.
    - A superuser cannot demote themselves — this prevents accidental lock-out.
    - Setting is_superuser=True also ensures is_staff=True (required for Django admin).
    - Setting is_superuser=False clears is_superuser but preserves is_staff so
      the user retains application-admin access if they still hold the role.
    - Target user must hold the 'administrator' role grant. It makes no sense
      to give Django backend access to a non-administrator.
    """
    permission_classes = (IsAdministrator,)

    def patch(self, request, pk):
        # ── Caller must be a superuser, not just an application admin ──────
        if not request.user.is_superuser:
            return Response(
                {
                    'code': 'superuser_required',
                    'detail': (
                        'Only a superuser can promote or demote Django backend access. '
                        'Application administrators cannot grant this privilege.'
                    ),
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        User = get_user_model()
        try:
            target = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        # ── Self-demotion guard ────────────────────────────────────────────
        if target.pk == request.user.pk:
            return Response(
                {
                    'code': 'self_demotion_denied',
                    'detail': 'You cannot change your own superuser status.',
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # ── Validate payload ───────────────────────────────────────────────
        value = request.data.get('is_superuser')
        if value is None or not isinstance(value, bool):
            return Response(
                {'detail': 'Provide { "is_superuser": true } or { "is_superuser": false }.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Require the target to hold the administrator role ──────────────
        from .permissions import get_user_roles
        if value is True and 'administrator' not in get_user_roles(target):
            return Response(
                {
                    'code': 'role_required',
                    'detail': (
                        'Django backend access can only be granted to users who '
                        'already hold the Administrator role.'
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Apply the change ───────────────────────────────────────────────
        with transaction.atomic():
            if value is True:
                # Promote: both flags required for Django admin access
                User.objects.filter(pk=target.pk).update(
                    is_superuser=True,
                    is_staff=True,
                )
            else:
                # Demote: clear superuser but keep is_staff (app admin stays intact)
                User.objects.filter(pk=target.pk).update(
                    is_superuser=False,
                )

        target.refresh_from_db(fields=['is_superuser', 'is_staff'])
        action = 'granted' if value else 'revoked'
        return Response({
            'detail': f'Django backend access {action} for {target.get_full_name() or target.username}.',
            'is_superuser': target.is_superuser,
            'is_staff':     target.is_staff,
        })


# ---------------------------------------------------------------------------
# Rate limiting — admin management views
# ---------------------------------------------------------------------------

class RateLimitRuleListCreate(generics.ListCreateAPIView):
    """
    GET  /api/v1/admin/rate-limits/rules/   — list all rules (admin)
    POST /api/v1/admin/rate-limits/rules/   — create a new rule (admin)
    """
    permission_classes = (IsAdministrator,)
    pagination_class = None

    def get_serializer_class(self):
        from .serializers import RateLimitRuleSerializer
        return RateLimitRuleSerializer

    def get_queryset(self):
        from .models import RateLimitRule
        return RateLimitRule.objects.annotate_violation_counts() if hasattr(
            RateLimitRule.objects, 'annotate_violation_counts'
        ) else RateLimitRule.objects.all()


class RateLimitRuleDetail(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /api/v1/admin/rate-limits/rules/{id}/
    PATCH  /api/v1/admin/rate-limits/rules/{id}/
    DELETE /api/v1/admin/rate-limits/rules/{id}/
    """
    permission_classes = (IsAdministrator,)
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']

    def get_serializer_class(self):
        from .serializers import RateLimitRuleSerializer
        return RateLimitRuleSerializer

    def get_queryset(self):
        from .models import RateLimitRule
        return RateLimitRule.objects.all()

    def perform_destroy(self, instance):
        from .throttling import _invalidate_rule_cache
        scope = instance.scope
        instance.delete()
        _invalidate_rule_cache(scope)


class RateLimitViolationListView(generics.ListAPIView):
    """
    GET /api/v1/admin/rate-limits/violations/
        ?rule=<id>
        &unresolved=1
        &identifier=<str>
        &action=blocked|warned|suspended
        &from=YYYY-MM-DD
        &to=YYYY-MM-DD
        &page=1&page_size=50
    """
    permission_classes = (IsAdministrator,)

    def get_serializer_class(self):
        from .serializers import RateLimitViolationSerializer
        return RateLimitViolationSerializer

    def get_queryset(self):
        from .models import RateLimitViolation
        qs = RateLimitViolation.objects.select_related('rule', 'user', 'resolved_by')

        rule_id = self.request.query_params.get('rule')
        if rule_id:
            qs = qs.filter(rule_id=rule_id)

        unresolved = self.request.query_params.get('unresolved')
        if unresolved == '1':
            qs = qs.filter(is_resolved=False)

        identifier = self.request.query_params.get('identifier', '').strip()
        if identifier:
            qs = qs.filter(identifier__icontains=identifier)

        action = self.request.query_params.get('action', '').strip()
        if action:
            qs = qs.filter(action_taken=action)

        from_date = self.request.query_params.get('from')
        to_date   = self.request.query_params.get('to')
        if from_date:
            qs = qs.filter(created_at__date__gte=from_date)
        if to_date:
            qs = qs.filter(created_at__date__lte=to_date)

        return qs


class RateLimitViolationDetail(generics.RetrieveUpdateAPIView):
    """
    GET   /api/v1/admin/rate-limits/violations/{id}/  — view one violation
    PATCH /api/v1/admin/rate-limits/violations/{id}/  — resolve / add notes
    """
    permission_classes = (IsAdministrator,)
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_serializer_class(self):
        from .serializers import RateLimitViolationSerializer
        return RateLimitViolationSerializer

    def get_queryset(self):
        from .models import RateLimitViolation
        return RateLimitViolation.objects.select_related('rule', 'user', 'resolved_by')

    def perform_update(self, serializer):
        from django.utils import timezone
        update_data = {}
        if serializer.validated_data.get('is_resolved') and not serializer.instance.is_resolved:
            update_data['resolved_by'] = self.request.user
            update_data['resolved_at'] = timezone.now()
        serializer.save(**update_data)


class RateLimitViolationBulkResolveView(APIView):
    """
    POST /api/v1/admin/rate-limits/violations/resolve-all/
         { "rule_id": <id>, "identifier": "<str>" }   (both optional filters)

    Marks all matching unresolved violations as resolved.
    """
    permission_classes = (IsAdministrator,)

    def post(self, request):
        from .models import RateLimitViolation
        from django.utils import timezone

        qs = RateLimitViolation.objects.filter(is_resolved=False)

        rule_id = request.data.get('rule_id')
        if rule_id:
            qs = qs.filter(rule_id=rule_id)

        identifier = str(request.data.get('identifier', '')).strip()
        if identifier:
            qs = qs.filter(identifier=identifier)

        count = qs.update(
            is_resolved=True,
            resolved_by=request.user,
            resolved_at=timezone.now(),
        )
        return Response({'resolved': count}, status=status.HTTP_200_OK)


class RateLimitStatsView(APIView):
    """
    GET /api/v1/admin/rate-limits/stats/
    Returns summary statistics used by the admin dashboard widget.
    """
    permission_classes = (IsAdministrator,)

    def get(self, request):
        from .models import RateLimitRule, RateLimitViolation
        from django.utils import timezone
        from datetime import timedelta

        now  = timezone.now()
        day  = now - timedelta(hours=24)
        week = now - timedelta(days=7)

        total_rules    = RateLimitRule.objects.count()
        active_rules   = RateLimitRule.objects.filter(is_active=True).count()
        violations_24h = RateLimitViolation.objects.filter(created_at__gte=day).count()
        violations_7d  = RateLimitViolation.objects.filter(created_at__gte=week).count()
        unresolved     = RateLimitViolation.objects.filter(is_resolved=False).count()
        auto_suspended = RateLimitViolation.objects.filter(
            action_taken='suspended', is_resolved=False
        ).count()

        # Top 5 scopes by unresolved violations
        from django.db.models import Count
        top_scopes = (
            RateLimitViolation.objects
            .filter(is_resolved=False)
            .values('rule__scope', 'rule__label')
            .annotate(count=Count('id'))
            .order_by('-count')[:5]
        )

        return Response({
            'total_rules':    total_rules,
            'active_rules':   active_rules,
            'violations_24h': violations_24h,
            'violations_7d':  violations_7d,
            'unresolved':     unresolved,
            'auto_suspended': auto_suspended,
            'top_scopes': [
                {'scope': r['rule__scope'], 'label': r['rule__label'], 'count': r['count']}
                for r in top_scopes
            ],
        })


class RateLimitSeedView(APIView):
    """
    POST /api/v1/admin/rate-limits/seed/
    Creates default rules for any scope that has no rule yet (idempotent).
    """
    permission_classes = (IsAdministrator,)

    def post(self, request):
        from .throttling import seed_default_rules, DEFAULT_RULES
        from .models import RateLimitRule
        before = RateLimitRule.objects.count()
        seed_default_rules()
        after = RateLimitRule.objects.count()
        return Response({
            'created': after - before,
            'total':   after,
        }, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Email verification views
# ---------------------------------------------------------------------------

class VerifyEmailView(APIView):
    """
    POST /api/v1/auth/verify-email/
         { "token": "<raw_token_from_email>" }

    Validates the single-use token, activates the account, and marks the
    email as verified.  Returns 200 with the user's session data so the
    frontend can log the user in immediately after verification.

    Security properties
    ───────────────────
    - All error responses use the same generic message regardless of failure
      reason (invalid token / expired / already used / wrong user) to prevent
      information disclosure.
    - The token is looked up by its SHA-256 hash; the raw token is never
      stored or logged.
    - Verification attempts are rate-limited at the throttle layer.
    - After successful verification a session is established so the user
      does not have to log in separately.
    """
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (AuthLoginThrottle,)   # reuse login rate limit

    @method_decorator(csrf_protect)
    def post(self, request):
        raw_token = (request.data.get('token') or '').strip()
        if not raw_token:
            return Response(
                {'detail': 'Verification token is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .email_verification import verify_token_and_activate
        try:
            user = verify_token_and_activate(raw_token)
        except ValueError as exc:
            return Response(
                {'detail': str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Log the user in immediately — they just proved email ownership.
        login(request, user, backend='helpdesk.authentication.EmailOrUsernameBackend')
        return Response(
            {
                'detail': 'Email verified. Your account is now active.',
                'user': UserSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


class ResendVerificationView(APIView):
    """
    POST /api/v1/auth/resend-verification/
         { "email": "<user@iic.edu.np>" }

    Generates a fresh verification token and dispatches the verification
    email.

    Security properties
    ───────────────────
    - Response is deliberately generic regardless of whether the email is
      registered, already verified, or unrecognised — prevents account
      enumeration.
    - Rate-limited to prevent email flooding.
    - The previous token is invalidated when a new one is created.
    - Does nothing if the account is already verified.
    """
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (AuthRegisterThrottle,)  # same 5/hour limit

    @method_decorator(csrf_protect)
    def post(self, request):
        from .email_verification import send_verification_email

        # Generic response used in ALL cases to prevent enumeration
        _generic = Response(
            {
                'detail': (
                    'If that email address is registered and awaiting verification, '
                    'a new verification email has been sent.'
                ),
            },
            status=status.HTTP_200_OK,
        )

        email = (request.data.get('email') or '').strip().lower()
        if not email:
            return _generic

        # Domain check — don't reveal whether the domain matters
        if not email_domain_allowed(email):
            return _generic

        User = get_user_model()
        try:
            user = User.objects.select_related('profile').get(email__iexact=email)
        except User.DoesNotExist:
            return _generic

        # If already verified and active — silently succeed
        try:
            if user.profile.email_verified and user.is_active:
                return _generic
        except Exception:
            return _generic

        # If suspended — silently succeed (do not reveal suspension)
        try:
            if user.profile.is_suspended:
                return _generic
        except Exception:
            return _generic

        # Re-send verification email (creates new token, invalidates old one)
        send_verification_email(user)
        return _generic


# ---------------------------------------------------------------------------
# Forgot password / password reset
# ---------------------------------------------------------------------------

def _send_password_reset_email(user, raw_token: str) -> None:
    """
    Dispatch the password-reset email in a background thread.
    The raw token is NEVER logged — only passed inside the email body.

    HTML body rendered from helpdesk/templates/email/password_reset.html.
    """
    from .email_config_service import get_effective_from_email
    from .email_utils import render_email, send_email_async
    from .signals import get_support_email as _pwd_support_email

    helpdesk_url = getattr(settings, 'HELPDESK_URL', 'http://localhost:3000').rstrip('/')
    reset_url    = f'{helpdesk_url}/reset-password?token={raw_token}'
    name         = user.get_full_name() or user.username
    expiry_hours = int(getattr(settings, 'PASSWORD_RESET_TOKEN_EXPIRY_HOURS', 2))

    plain = (
        f'Hi {name},\n\n'
        f'You requested a password reset for your IIC IT Helpdesk account.\n\n'
        f'Click the link below to set a new password:\n\n'
        f'{reset_url}\n\n'
        f'This link expires in {expiry_hours} hour(s).\n\n'
        f'If you did not request this, you can safely ignore this email.\n\n'
        f'— IIC IT & NOC Department'
    )

    html = render_email('email/password_reset.html', {
        'name':          name,
        'reset_url':     reset_url,
        'expiry_hours':  expiry_hours,
        'support_email': _pwd_support_email(),
    })

    send_email_async(
        subject    = '[IIC IT Helpdesk] Reset your password',
        plain      = plain,
        html       = html,
        to         = user.email,
        from_email = get_effective_from_email(),
        log_tag    = f'password_reset user_id={user.pk}',
    )


class ForgotPasswordView(APIView):
    """
    POST /api/v1/auth/forgot-password/
         { "email": "user@iic.edu.np" }

    Sends a password-reset link to the email address if it belongs to
    an active, verified account.  Always returns the same generic 200
    response to prevent account/email enumeration.

    Rate-limited via AuthRegisterThrottle (5/hour per IP).
    """
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)
    throttle_classes   = (AuthRegisterThrottle,)

    @method_decorator(csrf_protect)
    def post(self, request):
        from .models import PasswordResetToken

        # Generic response used in ALL cases — prevents enumeration
        _ok = Response(
            {'detail': 'If that email belongs to an active account, a reset link has been sent.'},
            status=status.HTTP_200_OK,
        )

        email = (request.data.get('email') or '').strip().lower()
        if not email:
            return _ok

        User = get_user_model()
        try:
            user = User.objects.select_related('profile').get(
                email__iexact=email, is_active=True
            )
        except User.DoesNotExist:
            return _ok

        # Only verified, non-suspended accounts can request a reset
        try:
            profile = user.profile
            if profile.is_suspended or not profile.email_verified:
                return _ok
        except Exception:
            return _ok

        raw_token, _instance = PasswordResetToken.create_for_user(user)
        _send_password_reset_email(user, raw_token)
        return _ok


class ResetPasswordView(APIView):
    """
    POST /api/v1/auth/reset-password/
         { "token": "<raw_token>", "password": "<new_password>", "confirm_password": "<new_password>" }

    Validates the token, enforces password policy, sets the new password,
    and marks the token as used.  Returns 200 on success.
    """
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)
    throttle_classes   = (AuthLoginThrottle,)   # 10/minute — same as login

    @method_decorator(csrf_protect)
    def post(self, request):
        from .models import PasswordResetToken
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.utils import timezone

        raw_token        = (request.data.get('token') or '').strip()
        password         = (request.data.get('password') or '').strip()
        confirm_password = (request.data.get('confirm_password') or '').strip()

        if not raw_token:
            return Response({'detail': 'Reset token is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not password:
            return Response({'detail': 'New password is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if password != confirm_password:
            return Response({'detail': 'Passwords do not match.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Validate token
        try:
            token = PasswordResetToken.verify(raw_token)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Validate new password against Django's AUTH_PASSWORD_VALIDATORS
        user = token.user
        try:
            validate_password(password, user=user)
        except DjangoValidationError as exc:
            return Response({'password': list(exc.messages)},
                            status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            token.used_at = timezone.now()
            token.save(update_fields=['used_at'])
            user.set_password(password)
            user.save(update_fields=['password'])

        return Response(
            {'detail': 'Password reset successfully. You can now sign in with your new password.'},
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# User profile (own account)
# ---------------------------------------------------------------------------

class UserProfileView(generics.RetrieveUpdateAPIView):
    """
    GET   /api/v1/auth/profile/  — return the authenticated user's profile
    PATCH /api/v1/auth/profile/  — update first_name, last_name, programme, department

    Password change is handled separately at /api/v1/auth/change-password/.
    """
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_serializer_class(self):
        from .serializers import ProfileSerializer
        return ProfileSerializer

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    """
    POST /api/v1/auth/change-password/
         { "current_password": "...", "new_password": "...", "confirm_password": "..." }

    Requires the user to supply their current password as confirmation.
    """
    throttle_classes = (ChangePasswordThrottle,)

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        user             = request.user
        current_password = (request.data.get('current_password') or '').strip()
        new_password     = (request.data.get('new_password') or '').strip()
        confirm_password = (request.data.get('confirm_password') or '').strip()

        if not current_password:
            return Response({'detail': 'Current password is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not user.check_password(current_password):
            return Response({'detail': 'Current password is incorrect.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not new_password:
            return Response({'detail': 'New password is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if new_password != confirm_password:
            return Response({'detail': 'Passwords do not match.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if new_password == current_password:
            return Response({'detail': 'New password must be different from the current one.'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            return Response({'new_password': list(exc.messages)},
                            status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=['password'])
        # Re-establish the session so the user stays logged in after password change
        from django.contrib.auth import update_session_auth_hash
        update_session_auth_hash(request, user)

        return Response(
            {'detail': 'Password changed successfully.'},
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Service status — public board + admin management
# ---------------------------------------------------------------------------


class PublicServiceStatusView(APIView):
    """
    GET /api/v1/status/

    Public, unauthenticated endpoint.  Returns:
    {
      "overall": "operational" | "degraded" | "outage" | "maintenance",
      "services": [ {id, category_name, category_slug, category_icon,
                      status, status_label, message,
                      incident_started_at, estimated_resolution, updated_at}, ... ]
    }

    Only active service categories are included. Categories that don't have
    a ServiceStatus row yet are shown as "operational" (on-the-fly).
    """
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)

    def get(self, request):
        from .models import ServiceStatus
        from .serializers import ServiceStatusSerializer

        active_categories = ServiceCategory.objects.filter(is_active=True).order_by(
            'sort_order', 'name'
        )

        # Fetch all existing status rows in one query
        status_map = {
            ss.category_id: ss
            for ss in ServiceStatus.objects.select_related('category').all()
        }

        results = []
        worst = 'operational'
        priority = ['outage', 'maintenance', 'degraded', 'operational']

        for cat in active_categories:
            if cat.pk in status_map:
                ss = status_map[cat.pk]
            else:
                # Virtual row — no DB write needed
                ss = ServiceStatus(
                    category=cat,
                    status=ServiceStatus.Status.OPERATIONAL,
                )
            results.append(ss)
            # Track the worst-case overall status
            if priority.index(ss.status) < priority.index(worst):
                worst = ss.status

        serializer = ServiceStatusSerializer(results, many=True)
        return Response({'overall': worst, 'services': serializer.data})


class AdminServiceStatusListView(generics.ListAPIView):
    """
    GET /api/v1/admin/status/

    Returns all ServiceStatus rows for management. Includes categories that
    don't have a row yet (virtual operational rows, not persisted).
    """
    permission_classes = (IsAdministrator,)
    serializer_class   = None  # set dynamically
    pagination_class   = None

    def get(self, request):
        from .models import ServiceStatus
        from .serializers import AdminServiceStatusSerializer

        active_categories = ServiceCategory.objects.filter(is_active=True).order_by(
            'sort_order', 'name'
        )
        status_map = {
            ss.category_id: ss
            for ss in ServiceStatus.objects.select_related('category', 'updated_by').all()
        }
        results = []
        for cat in active_categories:
            ss = status_map.get(cat.pk)
            if ss is None:
                ss = ServiceStatus(category=cat, status=ServiceStatus.Status.OPERATIONAL)
            results.append(ss)

        serializer = AdminServiceStatusSerializer(results, many=True)
        return Response(serializer.data)


class AdminServiceStatusDetailView(APIView):
    """
    PATCH /api/v1/admin/status/{category_id}/

    Upserts the ServiceStatus row for a given ServiceCategory (by category PK).
    Writable fields: status, message, incident_started_at, estimated_resolution.
    """
    permission_classes = (IsAdministrator,)

    def patch(self, request, category_id):
        from .models import ServiceStatus
        from .serializers import AdminServiceStatusSerializer

        try:
            category = ServiceCategory.objects.get(pk=category_id)
        except ServiceCategory.DoesNotExist:
            return Response({'detail': 'Service category not found.'}, status=status.HTTP_404_NOT_FOUND)

        ss, _ = ServiceStatus.objects.get_or_create(
            category=category,
            defaults={'status': ServiceStatus.Status.OPERATIONAL},
        )

        serializer = AdminServiceStatusSerializer(ss, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Ticket feedback — requester submits after resolution
# ---------------------------------------------------------------------------


class TicketFeedbackView(APIView):
    """
    GET  /api/v1/tickets/{pk}/feedback/
         Returns existing feedback for the ticket (requester or staff).

    POST /api/v1/tickets/{pk}/feedback/
         Submits satisfaction feedback.  Rules:
         - Only the requester may submit feedback.
         - Ticket must be in 'resolved' or 'closed' status.
         - One submission per ticket (OneToOneField enforced by DB).
    """

    def _get_ticket_or_404(self, request, pk):
        """Return (ticket, is_staff) or None on access/not-found."""
        from uuid import UUID
        from .permissions import get_user_roles

        try:
            ticket = Ticket.objects.select_related('requester').get(pk=UUID(pk))
        except (Ticket.DoesNotExist, ValueError):
            return None, False

        roles = get_user_roles(request.user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        is_staff = bool(roles.intersection(staff_roles)) or request.user.is_superuser

        if not is_staff and ticket.requester_id != request.user.pk:
            return None, False

        return ticket, is_staff

    def get(self, request, pk):
        from .models import TicketFeedback
        from .serializers import TicketFeedbackSerializer

        ticket, _ = self._get_ticket_or_404(request, pk)
        if ticket is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            feedback = ticket.feedback
        except TicketFeedback.DoesNotExist:
            return Response({'detail': 'No feedback submitted yet.'}, status=status.HTTP_404_NOT_FOUND)

        return Response(TicketFeedbackSerializer(feedback).data)

    @transaction.atomic
    def post(self, request, pk):
        from .models import TicketFeedback
        from .serializers import TicketFeedbackSerializer

        ticket, is_staff = self._get_ticket_or_404(request, pk)
        if ticket is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Only the requester submits feedback
        if is_staff:
            return Response(
                {'detail': 'Staff members cannot submit ticket feedback.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Ticket must be resolved or closed
        if ticket.status not in ('resolved', 'closed'):
            return Response(
                {'detail': 'Feedback can only be submitted once a ticket has been resolved or closed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Prevent duplicate submission
        if TicketFeedback.objects.filter(ticket=ticket).exists():
            return Response(
                {'detail': 'Feedback has already been submitted for this ticket.'},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = TicketFeedbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(ticket=ticket, submitted_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AdminFeedbackListView(generics.ListAPIView):
    """
    GET /api/v1/admin/feedback/
    Lists all ticket feedback for admin review with optional filters.
    ?rating=4,5   — filter by rating values (comma-separated)
    """
    permission_classes = (IsAdministrator,)
    pagination_class   = None

    def get_serializer_class(self):
        from .serializers import TicketFeedbackSerializer
        return TicketFeedbackSerializer

    def get_queryset(self):
        from .models import TicketFeedback
        qs = TicketFeedback.objects.select_related('ticket', 'submitted_by').order_by('-created_at')
        rating_param = self.request.query_params.get('rating', '').strip()
        if rating_param:
            ratings = [r.strip() for r in rating_param.split(',') if r.strip().isdigit()]
            if ratings:
                qs = qs.filter(rating__in=[int(r) for r in ratings])
        return qs


# ---------------------------------------------------------------------------
# Gated software file download
# ---------------------------------------------------------------------------


class SoftwareDownloadView(APIView):
    """
    GET /api/v1/software/{slug}/download/

    Streams an uploaded installer file to the requesting user ONLY after
    verifying:
      1. The SoftwareResource exists and is active.
      2. An uploaded file is actually attached (file field is non-empty).
      3. The requesting user's role permits the resource's audience:
            public     → anyone (unauthenticated included)
            all        → authenticated users with any role
            student    → users whose role grants student or higher audience access
            staff      → users whose role grants staff audience access
    
    Why a gated view instead of direct /media/ ?
    ────────────────────────────────────────────
    Django's /media/ route (dev) and Nginx's static serving (prod) both
    bypass the Django auth stack entirely — any URL-guesser can download
    a file even if it is restricted to "Students only".  This view sits
    in front of the file, runs the same audience logic used by
    get_permitted_audiences(), and only then hands the bytes to the client.

    File delivery
    ─────────────
    Development  → FileResponse streams the file directly from Django.
    Production   → Set MEDIA_ACCEL_REDIRECT=true in .env to use the
                   X-Accel-Redirect header (Nginx) instead.  Django only
                   sends the header; Nginx serves the bytes — far more
                   efficient for large files.
    """

    authentication_classes = ()   # we inspect request.user manually
    permission_classes     = (permissions.AllowAny,)

    def get(self, request, slug: str):
        from django.conf import settings as _settings
        from django.http import FileResponse, Http404, HttpResponse

        # ── 1. Look up the resource ────────────────────────────────────────
        try:
            resource = SoftwareResource.objects.get(
                slug=slug,
                status=SoftwareResource.Status.ACTIVE,
            )
        except SoftwareResource.DoesNotExist:
            return HttpResponse(status=404)

        # ── 2. File must be attached ───────────────────────────────────────
        if not resource.file:
            return HttpResponse(status=404)

        # ── 3. Audience / auth check ───────────────────────────────────────
        permitted = get_permitted_audiences(request)
        if resource.audience not in permitted:
            # Not authenticated at all and resource requires login
            if not request.user or not request.user.is_authenticated:
                return HttpResponse(status=401)
            # Authenticated but wrong role for this audience
            return HttpResponse(status=403)

        # ── 4. Serve the file ─────────────────────────────────────────────
        use_accel = _settings.MEDIA_ACCEL_REDIRECT  # Nginx X-Accel-Redirect

        if use_accel:
            # Production fast path — Nginx does the actual byte transfer.
            # The internal location /protected-media/ must be configured in
            # nginx.conf to alias MEDIA_ROOT with `internal;`.
            file_path = resource.file.name   # relative to MEDIA_ROOT
            response = HttpResponse()
            response['X-Accel-Redirect'] = f'/protected-media/{file_path}'
            response['Content-Type']     = 'application/octet-stream'
            response['Content-Disposition'] = (
                f'attachment; filename="{resource.file.name.rsplit("/", 1)[-1]}"'
            )
            return response

        # Dev / fallback — Django streams the file directly.
        try:
            file_handle = resource.file.open('rb')
        except OSError:
            return HttpResponse(status=404)

        filename = resource.file.name.rsplit('/', 1)[-1]
        response = FileResponse(
            file_handle,
            as_attachment=True,
            filename=filename,
        )
        return response


# ---------------------------------------------------------------------------
# Chunked file upload — three-step protocol
#
#  Step 1  POST /api/v1/upload/init/
#          Body: { filename, total_size, total_chunks, chunk_size }
#          → returns { upload_id, chunk_size }
#
#  Step 2  PUT  /api/v1/upload/{upload_id}/chunk/{index}/
#          Multipart body: { chunk: <binary> }  (one part, ≤ 95 MB)
#          → returns { received: index, progress: "N/total" }
#
#  Step 3  POST /api/v1/upload/{upload_id}/finalize/
#          Body: { dest_path: "software/2026/01/filename.exe" }
#          → returns { final_path }  (relative to MEDIA_ROOT)
#          The caller then PATCHes the SoftwareResource with the final_path.
#
# Access: IsContentEditor on all three endpoints.
# ---------------------------------------------------------------------------


class InitChunkedUploadView(APIView):
    """
    POST /api/v1/upload/init/

    Creates a ChunkedUpload session and returns the upload_id the
    frontend will use for all subsequent chunk and finalize requests.
    """
    permission_classes = (IsContentEditor,)

    # Hard limit: each chunk must be ≤ 50 MB.  This gives comfortable headroom
    # below Cloudflare's 100 MB body limit while still allowing efficient
    # transfers on direct connections.  The admin settings UI caps at 50 MB.
    MAX_CHUNK_BYTES = 50 * 1024 * 1024          # 50 MB
    MAX_TOTAL_BYTES = 25 * 1024 * 1024 * 1024   # 25 GB

    def post(self, request):
        from .models import ChunkedUpload

        filename     = str(request.data.get('filename', '')).strip()
        total_size   = request.data.get('total_size')
        total_chunks = request.data.get('total_chunks')
        chunk_size   = request.data.get('chunk_size')

        # ── Validate ──────────────────────────────────────────────────────
        errors = {}
        if not filename:
            errors['filename'] = 'filename is required.'
        if total_size is None:
            errors['total_size'] = 'total_size is required.'
        elif not isinstance(total_size, int) or total_size <= 0:
            errors['total_size'] = 'total_size must be a positive integer.'
        elif total_size > self.MAX_TOTAL_BYTES:
            errors['total_size'] = f'File exceeds the 25 GB maximum ({total_size} bytes).'
        if total_chunks is None:
            errors['total_chunks'] = 'total_chunks is required.'
        elif not isinstance(total_chunks, int) or total_chunks <= 0:
            errors['total_chunks'] = 'total_chunks must be a positive integer.'
        if chunk_size is None:
            errors['chunk_size'] = 'chunk_size is required.'
        elif not isinstance(chunk_size, int) or chunk_size <= 0:
            errors['chunk_size'] = 'chunk_size must be a positive integer.'
        elif chunk_size > self.MAX_CHUNK_BYTES:
            errors['chunk_size'] = (
                f'chunk_size {chunk_size} exceeds the 50 MB per-chunk maximum. '
                f'Use {self.MAX_CHUNK_BYTES} bytes or smaller.'
            )
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        upload = ChunkedUpload.objects.create(
            uploaded_by   = request.user,
            original_name = filename,
            total_size    = total_size,
            total_chunks  = total_chunks,
            chunk_size    = chunk_size,
            status        = ChunkedUpload.Status.UPLOADING,
        )

        return Response({
            'upload_id':   str(upload.upload_id),
            'chunk_size':  chunk_size,
            'total_chunks': total_chunks,
        }, status=status.HTTP_201_CREATED)


class UploadChunkView(APIView):
    """
    PUT /api/v1/upload/{upload_id}/chunk/{index}/

    Receives a single binary chunk and stores it in the temporary chunk
    directory.  The chunk is sent as multipart/form-data with the field
    name 'chunk'.

    Idempotent: re-uploading the same index simply overwrites the stored
    chunk so the frontend can safely retry on network error.
    """
    permission_classes = (IsContentEditor,)
    parser_classes     = (MultiPartParser, FormParser)

    def put(self, request, upload_id: str, index: str):
        import os
        from .models import ChunkedUpload

        # index arrives as a string from the URL regex — cast immediately.
        try:
            index = int(index)
        except (ValueError, TypeError):
            return Response({'detail': 'index must be a non-negative integer.'}, status=status.HTTP_400_BAD_REQUEST)

        # ── Look up the session ───────────────────────────────────────────
        try:
            upload = ChunkedUpload.objects.get(
                upload_id=upload_id,
                uploaded_by=request.user,
            )
        except ChunkedUpload.DoesNotExist:
            return Response({'detail': 'Upload session not found.'}, status=status.HTTP_404_NOT_FOUND)

        if upload.status not in (ChunkedUpload.Status.UPLOADING, ChunkedUpload.Status.PENDING):
            return Response(
                {'detail': f'Upload session is {upload.status}, not accepting chunks.'},
                status=status.HTTP_409_CONFLICT,
            )

        # ── Validate index ────────────────────────────────────────────────
        if index < 0 or index >= upload.total_chunks:
            return Response(
                {'detail': f'index {index} out of range (0–{upload.total_chunks - 1}).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Get the chunk data ────────────────────────────────────────────
        chunk_file = request.FILES.get('chunk')
        if chunk_file is None:
            return Response({'detail': 'Multipart field "chunk" is required.'}, status=status.HTTP_400_BAD_REQUEST)

        max_chunk = 50 * 1024 * 1024  # 50 MB (matches admin settings UI max)
        if chunk_file.size > max_chunk:
            return Response(
                {'detail': f'Chunk too large ({chunk_file.size} bytes, max {max_chunk}).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Write chunk to disk ───────────────────────────────────────────
        chunk_dir  = upload.chunk_dir()
        chunk_path = upload.chunk_path(index)
        os.makedirs(chunk_dir, exist_ok=True)

        with open(chunk_path, 'wb') as f:
            for data in chunk_file.chunks():
                f.write(data)

        # ── Record receipt ────────────────────────────────────────────────
        received = upload.received_chunks
        if index not in received:
            received.append(index)
        upload.received_chunks = received
        upload.save(update_fields=['received_chunks', 'updated_at'])

        return Response({
            'received': index,
            'progress': f'{len(upload.received_chunks)}/{upload.total_chunks}',
            'complete': upload.all_chunks_received(),
        })


class FinalizeChunkedUploadView(APIView):
    """
    POST /api/v1/upload/{upload_id}/finalize/

    Verifies all chunks have arrived, assembles them into the final file,
    cleans up the temporary chunk directory, and marks the session complete.

    Body:
        { "dest_subdir": "software/2026/01" }   # sub-directory under MEDIA_ROOT
          (filename is taken from ChunkedUpload.original_name)

    Response:
        { "final_path": "software/2026/01/filename.exe" }
          (relative to MEDIA_ROOT — pass this to the SoftwareResource PATCH)
    """
    permission_classes = (IsContentEditor,)

    def post(self, request, upload_id: str):
        import os
        from django.utils.text import get_valid_filename
        from .models import ChunkedUpload

        # ── Look up session ───────────────────────────────────────────────
        try:
            upload = ChunkedUpload.objects.get(
                upload_id=upload_id,
                uploaded_by=request.user,
            )
        except ChunkedUpload.DoesNotExist:
            return Response({'detail': 'Upload session not found.'}, status=status.HTTP_404_NOT_FOUND)

        if upload.status == ChunkedUpload.Status.COMPLETE:
            # Idempotent: already finalized
            return Response({'final_path': upload.final_path})

        if upload.status not in (ChunkedUpload.Status.UPLOADING, ChunkedUpload.Status.PENDING):
            return Response(
                {'detail': f'Upload session is {upload.status}.'},
                status=status.HTTP_409_CONFLICT,
            )

        # ── All chunks must be present ────────────────────────────────────
        if not upload.all_chunks_received():
            missing = sorted(
                set(range(upload.total_chunks)) - set(upload.received_chunks)
            )
            return Response(
                {
                    'detail': 'Not all chunks have been received.',
                    'missing_chunks': missing[:20],   # first 20 only to keep response small
                },
                status=status.HTTP_409_CONFLICT,
            )

        # ── Determine destination path ────────────────────────────────────
        raw_subdir  = str(request.data.get('dest_subdir', '')).strip().strip('/')
        if not raw_subdir:
            # Auto-generate based on current date — mirrors Django's upload_to
            from django.utils import timezone
            now = timezone.now()
            raw_subdir = f'software/{now.year}/{now.month:02d}'

        safe_filename = get_valid_filename(upload.original_name)
        dest_relative = f'{raw_subdir}/{safe_filename}'

        # ── Assemble ──────────────────────────────────────────────────────
        try:
            upload.assemble(dest_relative)
        except FileNotFoundError as exc:
            upload.status = ChunkedUpload.Status.FAILED
            upload.save(update_fields=['status'])
            return Response(
                {'detail': f'Assembly failed: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # ── Mark complete, clean up chunks ────────────────────────────────
        upload.status     = ChunkedUpload.Status.COMPLETE
        upload.final_path = dest_relative
        upload.save(update_fields=['status', 'final_path', 'updated_at'])
        upload.cleanup_chunks()

        return Response({'final_path': dest_relative}, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Requester ticket priority promotion
# ---------------------------------------------------------------------------


class TicketPriorityView(APIView):
    """
    POST /api/v1/tickets/{pk}/priority/

    Allows a ticket's requester to promote (escalate) its priority.

    Rules
    ─────
    • Only the ticket's own requester may call this endpoint.
    • Priority can only be promoted (increased urgency), not demoted.
      p4 (Low) → p3 (Normal) → p2 (High) → p1 (Critical)
    • The ticket must be in an active, non-terminal status:
      submitted, triaged, in_progress, or waiting_requester.
    • The requester may promote at most once per priority level — once the
      ticket is already at Critical (p1) no further promotion is possible.

    Body
    ────
    { "priority": "p1" | "p2" | "p3" | "p4",
      "reason": "optional explanation shown in the history" }

    Response
    ────────
    Full TicketSerializer representation of the updated ticket.

    The priority change is recorded as a PRIORITY_CHANGED TicketEvent
    automatically by the post_save signal.  The actor is set to the
    requesting user so the history tab shows who changed it.
    """

    # Priority order — higher index = higher urgency
    _PRIORITY_ORDER = ['p4', 'p3', 'p2', 'p1']
    _PRIORITY_LABELS = {'p1': 'Critical', 'p2': 'High', 'p3': 'Normal', 'p4': 'Low'}

    # Statuses from which a requester may promote priority
    _PROMOTABLE_STATUSES = {
        Ticket.Status.SUBMITTED,
        Ticket.Status.TRIAGED,
        Ticket.Status.IN_PROGRESS,
        Ticket.Status.WAITING_REQUESTER,
    }

    def post(self, request, pk):
        from uuid import UUID

        # ── Look up ticket ────────────────────────────────────────────────
        try:
            ticket = Ticket.objects.select_related('requester').get(pk=UUID(str(pk)))
        except (Ticket.DoesNotExist, ValueError):
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        # ── Only the requester may call this ──────────────────────────────
        if ticket.requester_id != request.user.pk:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        # ── Ticket must be in a promotable status ─────────────────────────
        if ticket.status not in self._PROMOTABLE_STATUSES:
            return Response(
                {'detail': f'Priority cannot be changed while the ticket is {ticket.get_status_display()}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Validate the requested priority ──────────────────────────────
        new_priority = str(request.data.get('priority', '')).strip()
        if new_priority not in self._PRIORITY_ORDER:
            return Response(
                {'priority': [f'Invalid priority. Choose from: {", ".join(self._PRIORITY_ORDER)}.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Must be a promotion (higher urgency), not a demotion ──────────
        current_idx = self._PRIORITY_ORDER.index(ticket.priority)
        new_idx     = self._PRIORITY_ORDER.index(new_priority)

        if new_idx <= current_idx:
            current_label = self._PRIORITY_LABELS[ticket.priority]
            return Response(
                {
                    'detail': (
                        f'You can only increase the urgency of your request. '
                        f'The current priority is {current_label}.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Apply the change ──────────────────────────────────────────────
        reason = str(request.data.get('reason', '')).strip()[:500]

        # Set the event actor so the history tab shows the requester's name
        ticket._event_actor = request.user
        ticket.priority = new_priority
        if reason:
            # Store the reason as a note — we abuse status_reason momentarily
            # but immediately restore it so it doesn't overwrite a staff note.
            # Instead, attach as a temporary attribute read by the signal.
            ticket._priority_change_reason = reason

        ticket.save(update_fields=['priority', 'updated_at'])

        # Notify assigned staff (or all_staff rule) that the requester escalated.
        # The notification rule's recipient_type controls who actually receives it.
        try:
            from .notifications import send_event as _notify
            from .signals import _ticket_context
            ctx = _ticket_context(ticket, {
                'old_priority': self._PRIORITY_LABELS.get(
                    getattr(ticket, '_old_priority', ''), ticket.priority
                ),
                'new_priority': self._PRIORITY_LABELS[new_priority],
                'reason':       reason,
                # Default to_email is assignee if present — routing rule overrides
                'to_email': (
                    ticket.assigned_to.email
                    if ticket.assigned_to
                    else ''
                ),
            })
            _notify('priority_changed', ctx, ticket=ticket)
        except Exception as exc:
            import logging as _log
            _log.getLogger(__name__).exception(
                'Error sending priority_changed notification for ticket %s: %s',
                ticket.reference, exc,
            )

        return Response(TicketSerializer(ticket).data)
