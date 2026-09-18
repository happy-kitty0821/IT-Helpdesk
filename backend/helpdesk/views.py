from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.utils.text import slugify
from django.views.decorators.csrf import csrf_protect
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from rest_framework import generics, permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import AccountRecoveryToken, EmailTemplate, GuideArticle, NotificationChannel, NotificationLog, NotificationRule, RoleConfig, ServiceCategory, SoftwareResource, Ticket, TicketAttachment, TicketFormSettings, TicketMessage
from .permissions import IsAdministrator, IsContentEditor, IsITAgent, IsServiceLead
from .serializers import (
    AccountRecoveryTokenSerializer,
    AdminServiceCategorySerializer,
    EmailTemplateSerializer,
    GoogleCredentialSerializer,
    RoleConfigSerializer,
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
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = 'auth_register'

    @transaction.atomic
    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user, backend='helpdesk.authentication.EmailOrUsernameBackend')
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name='dispatch')
class LoginView(APIView):
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = 'auth_login'

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request,
            username=serializer.validated_data['identifier'],
            password=serializer.validated_data['password'],
        )
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
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = 'auth_google'

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
            user = User.objects.create_user(
                username=username,
                email=email,
                first_name=identity.get('given_name', '')[:150],
                last_name=identity.get('family_name', '')[:150],
            )
            user.set_unusable_password()
            user.save(update_fields=('password',))

        if not user.is_active:
            return Response({'detail': 'This account is inactive.'}, status=status.HTTP_403_FORBIDDEN)
        login(request, user, backend='helpdesk.authentication.EmailOrUsernameBackend')
        return Response(UserSerializer(user).data)


class ServiceCategoryList(generics.ListAPIView):
    permission_classes = (permissions.AllowAny,)
    pagination_class = None
    serializer_class = ServiceCategorySerializer

    def get_queryset(self):
        return ServiceCategory.objects.filter(
            audience__in=get_permitted_audiences(self.request),
            is_active=True,
        )


class TicketListCreate(generics.ListCreateAPIView):
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
            return qs
        # Regular users see only their own tickets
        return Ticket.objects.filter(requester=user).select_related('category', 'assigned_to')

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
    """
    POST /api/v1/tickets/{pk}/status/

    Rules:
    - Requester can: cancel (if status is submitted or triaged), close (if status is resolved)
    - Staff can: transition to any valid status

    Valid transitions:
    Requester: submitted/triaged -> cancelled, resolved -> closed
    Staff: any -> any (except from closed/cancelled)
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

        roles = get_user_roles(request.user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        is_staff = bool(roles.intersection(staff_roles))
        is_requester = ticket.requester_id == request.user.pk

        if not is_staff and not is_requester:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        current = ticket.status

        if is_staff:
            # Staff cannot reopen from closed/cancelled
            if current in ('closed', 'cancelled'):
                return Response(
                    {'detail': 'Closed or cancelled tickets cannot be transitioned.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            # Requester rules
            allowed = {
                'submitted': ('cancelled',),
                'triaged': ('cancelled',),
                'resolved': ('closed',),
            }
            if new_status not in allowed.get(current, ()):
                return Response(
                    {'detail': f'You cannot move this ticket from "{current}" to "{new_status}".'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        ticket.status = new_status
        ticket.save(update_fields=['status', 'updated_at'])
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
    permission_classes = (IsServiceLead,)

    def patch(self, request, pk):
        from rest_framework.exceptions import ValidationError
        from .permissions import get_user_roles, get_intern_scope_slugs, user_has_intern_scope_only

        try:
            ticket = Ticket.objects.select_related('category').get(pk=pk)
        except Ticket.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        assignee_id = request.data.get('assigned_to')
        team = request.data.get('team')

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

            # If assignee is intern-only, check category scope
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

        ticket.save()
        return Response(TicketSerializer(ticket).data)


class PublicGuideList(generics.ListAPIView):
    permission_classes = (permissions.AllowAny,)
    pagination_class = None
    serializer_class = GuideArticleSerializer

    def get_queryset(self):
        return GuideArticle.objects.filter(
            status=GuideArticle.Status.PUBLISHED,
            audience__in=get_permitted_audiences(self.request),
        ).select_related('created_by', 'updated_by')


class PublicSoftwareList(generics.ListAPIView):
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

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)


class AdminSoftwareDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsContentEditor,)
    serializer_class = SoftwareResourceSerializer
    queryset = SoftwareResource.objects.select_related('guide', 'updated_by')

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


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
    permission_classes = (IsAdministrator,)
    pagination_class = AdminUserPagination
    serializer_class = AdminUserSerializer

    def get_queryset(self):
        queryset = get_user_model().objects.prefetch_related('rolegrant_set').order_by('-is_superuser', '-is_staff', 'first_name', 'username')
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
            # Sync Django flags
            if 'administrator' in initial_roles:
                user.is_superuser = True
                user.is_staff = True
                user.save(update_fields=['is_superuser', 'is_staff'])
            elif any(r in initial_roles for r in ('service_lead', 'it_agent', 'it_noc_intern',
                                                    'content_editor', 'designated_approver', 'faculty_staff')):
                user.is_staff = True
                user.save(update_fields=['is_staff'])

        out = AdminUserSerializer(user, context={'request': request})
        return Response(out.data, status=status.HTTP_201_CREATED)


class AdminUserDetail(generics.RetrieveUpdateAPIView):
    permission_classes = (IsAdministrator,)
    serializer_class = AdminUserSerializer
    queryset = get_user_model().objects.all()


class AdminSummaryView(APIView):
    permission_classes = (IsAdministrator,)

    def get(self, request):
        User = get_user_model()
        return Response({
            'users': User.objects.filter(is_active=True).count(),
            'tickets': Ticket.objects.count(),
            'open_tickets': Ticket.objects.exclude(status__in=(Ticket.Status.CLOSED, Ticket.Status.CANCELLED)).count(),
            'guides': GuideArticle.objects.count(),
            'published_guides': GuideArticle.objects.filter(status=GuideArticle.Status.PUBLISHED).count(),
            'software': SoftwareResource.objects.count(),
            'active_software': SoftwareResource.objects.filter(status=SoftwareResource.Status.ACTIVE).count(),
        })


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
            # Sync Django flags
            if grant.role == 'administrator':
                get_user_model().objects.filter(pk=target.pk).update(is_superuser=True, is_staff=True)
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
            # Sync flags for administrator revocation
            if role == 'administrator':
                remaining = RoleGrant.objects.active_for(target).filter(role='administrator').exists()
                if not remaining:
                    User.objects.filter(pk=target.pk).update(is_superuser=False)
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
        from .signals import get_helpdesk_url

        try:
            ticket = Ticket.objects.select_related('requester', 'category').get(pk=pk)
        except Ticket.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if ticket.category.slug != 'account-recovery':
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
            'support_email': getattr(request, 'META', {}).get('HTTP_HOST', 'support@iic.edu.np'),
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
            PatternFill, Font, Alignment, Border, Side, GradientFill,
        )
        from openpyxl.utils import get_column_letter
        from django.utils import timezone
        from collections import Counter, defaultdict
        from datetime import timedelta

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

        priority_labels = {"p1": "Critical", "p2": "High", "p3": "Normal", "p4": "Low"}
        status_labels   = {
            "submitted": "Submitted", "triaged": "Triaged",
            "in_progress": "In Progress", "waiting_requester": "Waiting",
            "waiting_approval": "Awaiting Approval", "resolved": "Resolved",
            "closed": "Closed", "cancelled": "Cancelled",
        }

        now_utc  = timezone.now()
        iso_now  = now_utc.strftime("%Y-%m-%d %H:%M UTC")
        date_now = now_utc.strftime("%Y-%m-%d")

        def header_row(ws, col_defs: list[tuple[str, int]]):
            """Write a styled header row and set column widths."""
            for col_idx, (title, width) in enumerate(col_defs, start=1):
                cell = ws.cell(row=1, column=col_idx, value=title)
                cell.fill      = brand_fill
                cell.font      = header_font
                cell.alignment = header_align
                cell.border    = border
                ws.column_dimensions[get_column_letter(col_idx)].width = width

        def style_data_row(ws, row_num: int, num_cols: int, alt: bool):
            fill = alt_fill if alt else white_fill
            for c in range(1, num_cols + 1):
                cell = ws.cell(row=row_num, column=c)
                cell.fill   = fill
                cell.font   = normal_font
                cell.border = border

        # -- Collect all extra_field keys across all tickets -----------------

        extra_keys: list[str] = []
        seen_extra: set[str] = set()
        for t in tickets:
            for k in (t.extra_fields or {}).keys():
                if k not in seen_extra:
                    extra_keys.append(k)
                    seen_extra.add(k)

        # -- Sheet 1: Ticket Register ----------------------------------------

        ws1 = wb.active
        ws1.title = "Ticket Register"
        ws1.freeze_panes = "A2"

        # Add report metadata in rows before data (audit header)
        ws1.sheet_view.showGridLines = True

        # Title block
        ws1.merge_cells("A1:H1")
        title_cell = ws1["A1"]
        title_cell.value = "IIC IT Helpdesk — Ticket Register (Audit Export)"
        title_cell.font  = Font(bold=True, size=13, color="234395", name="Calibri")
        title_cell.alignment = Alignment(horizontal="left", vertical="center")

        ws1.merge_cells("A2:H2")
        ws1["A2"].value = f"Generated: {iso_now}    Tickets included: {len(tickets)}"
        ws1["A2"].font  = Font(size=9, color="64748B", italic=True, name="Calibri")

        ws1.row_dimensions[1].height = 22
        ws1.row_dimensions[2].height = 16

        # Fixed column definitions
        fixed_cols: list[tuple[str, int]] = [
            ("Reference",       14),
            ("Category",        22),
            ("Subject",         40),
            ("Status",          16),
            ("Priority",        12),
            ("Stage",           18),
            ("Requester Name",  22),
            ("Requester Email", 28),
            ("Assigned To",     22),
            ("Team",            16),
            ("Created (UTC)",   20),
            ("Updated (UTC)",   20),
            ("Resolved (UTC)",  20),
            ("Age at Export",   16),
            ("Resolution Time", 16),
            ("SLA Bucket",      12),
            ("Status Reason",   30),
        ]
        extra_col_defs = [(k, max(len(k) + 4, 18)) for k in extra_keys]
        all_cols = fixed_cols + extra_col_defs
        num_cols = len(all_cols)

        # Header row at row 3
        HEADER_ROW = 3
        for col_idx, (title, width) in enumerate(all_cols, start=1):
            cell = ws1.cell(row=HEADER_ROW, column=col_idx, value=title)
            cell.fill      = brand_fill
            cell.font      = header_font
            cell.alignment = header_align
            cell.border    = border
            ws1.column_dimensions[get_column_letter(col_idx)].width = width

        ws1.row_dimensions[HEADER_ROW].height = 28

        # Enable auto-filter on data range
        ws1.auto_filter.ref = f"A{HEADER_ROW}:{get_column_letter(num_cols)}{HEADER_ROW}"

        # Data rows
        for row_offset, ticket in enumerate(tickets):
            row_num = HEADER_ROW + 1 + row_offset
            is_alt  = (row_offset % 2 == 1)
            base_fill = alt_fill if is_alt else white_fill

            # Resolution time
            if ticket.status in ("resolved", "closed", "cancelled") and ticket.updated_at:
                res_td    = ticket.updated_at - ticket.created_at
                res_hours = res_td.total_seconds() / 3600
                res_str   = self._duration_str(res_td)
                sla       = self._sla_bucket(res_hours)
            else:
                age_td    = now_utc - ticket.created_at
                res_str   = "—"
                sla       = self._sla_bucket(age_td.total_seconds() / 3600)

            age_str = self._duration_str(now_utc - ticket.created_at)

            requester_name  = ticket.requester.get_full_name() if ticket.requester else "—"
            requester_email = ticket.requester.email if ticket.requester else "—"
            assignee        = (ticket.assigned_to.get_full_name() or ticket.assigned_to.username) if ticket.assigned_to else "Unassigned"

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
                ticket.updated_at.strftime("%Y-%m-%d %H:%M") if ticket.status in ("resolved", "closed") else "—",
                age_str,
                res_str,
                sla,
                ticket.status_reason or "—",
            ]
            # Extra fields
            for k in extra_keys:
                row_vals.append(str(ticket.extra_fields.get(k, "")) if ticket.extra_fields else "")

            for col_idx, val in enumerate(row_vals, start=1):
                cell = ws1.cell(row=row_num, column=col_idx, value=val)
                cell.fill      = base_fill
                cell.font      = normal_font
                cell.border    = border
                cell.alignment = center_align if col_idx in (4, 5, 6, 11, 12, 13, 14, 15, 16) else left_align

            # Highlight status and priority cells
            ws1.cell(row=row_num, column=4).fill = status_fills.get(ticket.status, base_fill)
            ws1.cell(row=row_num, column=5).fill = priority_fills.get(ticket.priority, base_fill)

            ws1.row_dimensions[row_num].height = 16

        # -- Sheet 2: Analytics Summary --------------------------------------

        ws2 = wb.create_sheet("Analytics Summary")
        ws2.sheet_view.showGridLines = False
        ws2.column_dimensions["A"].width = 32
        ws2.column_dimensions["B"].width = 18
        ws2.column_dimensions["C"].width = 18
        ws2.column_dimensions["D"].width = 18

        section_fill  = PatternFill("solid", fgColor="234395")
        section_font  = Font(bold=True, color="FFFFFF", size=11, name="Calibri")
        kpi_label_font = Font(bold=True, size=10, color="334155", name="Calibri")
        kpi_val_font   = Font(bold=True, size=20, color="234395", name="Calibri")
        sub_fill       = PatternFill("solid", fgColor="EEF2FF")
        sub_font       = Font(bold=True, size=9, color="234395", name="Calibri")

        row = 1

        def section_header(title: str):
            nonlocal row
            ws2.merge_cells(f"A{row}:D{row}")
            cell = ws2.cell(row=row, column=1, value=title)
            cell.fill      = section_fill
            cell.font      = section_font
            cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws2.row_dimensions[row].height = 24
            row += 1

        def write_kv(label: str, value, bold_val: bool = True):
            nonlocal row
            lc = ws2.cell(row=row, column=1, value=label)
            lc.font = kpi_label_font
            vc = ws2.cell(row=row, column=2, value=value)
            vc.font = Font(bold=bold_val, size=10, name="Calibri")
            vc.alignment = Alignment(horizontal="right")
            ws2.row_dimensions[row].height = 16
            row += 1

        def write_table(header: list[str], rows_data: list[tuple], fills: list[PatternFill | None] | None = None):
            nonlocal row
            # Header
            for ci, h in enumerate(header, start=1):
                c = ws2.cell(row=row, column=ci, value=h)
                c.fill      = sub_fill
                c.font      = sub_font
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.border    = border
            ws2.row_dimensions[row].height = 18
            row += 1
            for ri, data_row in enumerate(rows_data):
                alt = ri % 2 == 1
                f   = fills[ri] if fills and ri < len(fills) else (alt_fill if alt else white_fill)
                for ci, val in enumerate(data_row, start=1):
                    c = ws2.cell(row=row, column=ci, value=val)
                    c.fill      = f or (alt_fill if alt else white_fill)
                    c.font      = normal_font
                    c.border    = border
                    c.alignment = Alignment(horizontal="right" if ci > 1 else "left")
                ws2.row_dimensions[row].height = 15
                row += 1
            row += 1  # blank spacer

        # -- Report metadata -------------------------------------------------

        ws2.merge_cells("A1:D1")
        title_a2 = ws2["A1"]
        title_a2.value = "IIC IT Helpdesk — Analytics Summary"
        title_a2.font  = Font(bold=True, size=14, color="234395", name="Calibri")
        title_a2.alignment = Alignment(horizontal="left", vertical="center")
        ws2.row_dimensions[1].height = 26
        row = 2

        ws2.merge_cells(f"A{row}:D{row}")
        ws2.cell(row=row, column=1, value=f"Generated: {iso_now}    Total tickets: {len(tickets)}").font = Font(size=9, italic=True, color="64748B", name="Calibri")
        row += 2

        # -- KPIs ------------------------------------------------------------

        section_header("Key Performance Indicators")

        total        = len(tickets)
        open_count   = sum(1 for t in tickets if t.status not in ("resolved", "closed", "cancelled"))
        resolved_cnt = sum(1 for t in tickets if t.status == "resolved")
        closed_cnt   = sum(1 for t in tickets if t.status == "closed")
        cancelled_cnt= sum(1 for t in tickets if t.status == "cancelled")
        critical_cnt = sum(1 for t in tickets if t.priority == "p1")
        unassigned   = sum(1 for t in tickets if not t.assigned_to and t.status not in ("closed","cancelled"))

        # Average resolution time for resolved/closed tickets
        res_times = []
        for t in tickets:
            if t.status in ("resolved", "closed") and t.updated_at and t.created_at:
                res_times.append((t.updated_at - t.created_at).total_seconds() / 3600)
        avg_res = (sum(res_times) / len(res_times)) if res_times else None

        write_kv("Total tickets in export", total)
        write_kv("Open tickets",            open_count)
        write_kv("Resolved",                resolved_cnt)
        write_kv("Closed (confirmed)",      closed_cnt)
        write_kv("Cancelled",               cancelled_cnt)
        write_kv("Critical (P1) tickets",   critical_cnt)
        write_kv("Unassigned & open",       unassigned)
        write_kv("Avg resolution time",     f"{avg_res:.1f}h" if avg_res is not None else "—")
        row += 1

        # -- By status -------------------------------------------------------

        section_header("Tickets by Status")
        status_counts = Counter(t.status for t in tickets)
        write_table(
            ["Status", "Count", "% of Total"],
            [(status_labels.get(s, s), c, f"{c/total*100:.1f}%" if total else "—")
             for s, c in sorted(status_counts.items(), key=lambda x: -x[1])],
            fills=[status_fills.get(s) for s, _ in sorted(status_counts.items(), key=lambda x: -x[1])],
        )

        # -- By priority -----------------------------------------------------

        section_header("Tickets by Priority")
        prio_counts = Counter(t.priority for t in tickets)
        write_table(
            ["Priority", "Count", "% of Total"],
            [(priority_labels.get(p, p), c, f"{c/total*100:.1f}%" if total else "—")
             for p, c in sorted(prio_counts.items())],
            fills=[priority_fills.get(p) for p, _ in sorted(prio_counts.items())],
        )

        # -- By category -----------------------------------------------------

        section_header("Tickets by Service Category")
        cat_counts = Counter(
            (t.category.name if t.category else "Unknown") for t in tickets
        )
        write_table(
            ["Category", "Count", "% of Total"],
            [(cat, c, f"{c/total*100:.1f}%" if total else "—")
             for cat, c in sorted(cat_counts.items(), key=lambda x: -x[1])],
        )

        # -- SLA distribution ------------------------------------------------

        section_header("SLA Bucket Distribution (Time to Resolve / Current Age)")
        sla_buckets = Counter()
        for t in tickets:
            if t.status in ("resolved", "closed") and t.updated_at and t.created_at:
                h = (t.updated_at - t.created_at).total_seconds() / 3600
            else:
                h = (now_utc - t.created_at).total_seconds() / 3600
            sla_buckets[self._sla_bucket(h)] += 1

        bucket_order = ["= 4h", "= 8h", "= 24h", "= 3d", "= 7d", "> 7d"]
        write_table(
            ["SLA Bucket", "Count", "% of Total"],
            [(b, sla_buckets[b], f"{sla_buckets[b]/total*100:.1f}%" if total else "—")
             for b in bucket_order if sla_buckets[b] > 0],
        )

        # -- Assignee workload ------------------------------------------------

        section_header("Assignee Workload")
        assignee_counts: Counter[str] = Counter()
        for t in tickets:
            name = (t.assigned_to.get_full_name() or t.assigned_to.username) if t.assigned_to else "Unassigned"
            assignee_counts[name] += 1
        write_table(
            ["Assignee", "Tickets"],
            [(a, c) for a, c in sorted(assignee_counts.items(), key=lambda x: -x[1])],
        )

        # -- Submission by day-of-week ---------------------------------------

        section_header("Submissions by Day of Week")
        dow_labels = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
        dow_counts: Counter[int] = Counter(t.created_at.weekday() for t in tickets if t.created_at)
        write_table(
            ["Day", "Count"],
            [(dow_labels[d], dow_counts[d]) for d in range(7)],
        )

        # -- Submission by month ---------------------------------------------

        section_header("Submissions by Month")
        month_counts: Counter[str] = Counter(
            t.created_at.strftime("%Y-%m") for t in tickets if t.created_at
        )
        write_table(
            ["Month", "Count"],
            [(m, c) for m, c in sorted(month_counts.items())],
        )

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


class TicketStreamView(APIView):
    """
    GET /api/v1/tickets/{pk}/stream/

    Streams Server-Sent Events for a single ticket.  The client receives:

    event: connected       — sent once on connect; carries the current ticket snapshot
    event: ticket_update   — whenever ticket fields change (status, stage, assignee …)
    event: new_message     — whenever a new TicketMessage is saved
    event: error           — if the ticket is not found or the client is unauthorised

    The view polls the DB every ~1.5 s and diffs against the last-seen state.
    It honours intern scope restrictions and non-staff requester-only access.

    IMPORTANT: run Django with a threaded WSGI server (Gunicorn --worker-class=gthread
    or Django's built-in `runserver`, which is threaded) so long-lived streaming
    connections don't block other requests.
    """
    permission_classes = (permissions.IsAuthenticated,)
    # SSE connections must not be CSRF-checked (GET method, authenticated via session)
    authentication_classes = []   # handled manually below

    def get(self, request, pk):
        import json as _json
        import time
        from uuid import UUID
        from django.http import StreamingHttpResponse
        from django.contrib.auth import get_user_model

        # -- Manual session auth (authentication_classes is empty to skip CSRF) --
        from django.contrib.sessions.backends.db import SessionStore
        from rest_framework.authentication import SessionAuthentication
        try:
            auth = SessionAuthentication()
            result = auth.authenticate(request)
            if result:
                request._request.user = result[0]
            if not request.user or not request.user.is_authenticated:
                def _unauth():
                    yield _sse_format("error", _json.dumps({"detail": "Authentication required."}))
                return StreamingHttpResponse(_unauth(), content_type="text/event-stream")
        except Exception:
            pass

        # -- Resolve ticket + access check ---------------------------------
        from .permissions import get_user_roles, user_has_intern_scope_only, get_intern_scope_slugs

        try:
            ticket_pk = UUID(pk)
            ticket    = Ticket.objects.select_related("category", "requester", "assigned_to").get(pk=ticket_pk)
        except (Ticket.DoesNotExist, ValueError):
            def _notfound():
                yield _sse_format("error", _json.dumps({"detail": "Ticket not found."}))
            return StreamingHttpResponse(_notfound(), content_type="text/event-stream")

        roles       = get_user_roles(request.user)
        staff_roles = {"administrator", "service_lead", "it_agent", "it_noc_intern",
                       "content_editor", "designated_approver"}
        is_staff    = request.user.is_superuser or bool(roles.intersection(staff_roles))

        if is_staff:
            if not request.user.is_superuser and user_has_intern_scope_only(request.user):
                if ticket.category and ticket.category.slug not in get_intern_scope_slugs():
                    def _forbidden():
                        yield _sse_format("error", _json.dumps({"detail": "Access denied."}))
                    return StreamingHttpResponse(_forbidden(), content_type="text/event-stream")
        else:
            if ticket.requester_id != request.user.pk:
                def _forbidden2():
                    yield _sse_format("error", _json.dumps({"detail": "Access denied."}))
                return StreamingHttpResponse(_forbidden2(), content_type="text/event-stream")

        # -- Serialise ticket snapshot --------------------------------------

        def _ticket_snapshot(t: Ticket) -> dict:
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

        def _message_dict(m: TicketMessage, is_staff_viewer: bool) -> dict | None:
            if m.is_internal and not is_staff_viewer:
                return None
            return {
                "id":           m.id,
                "sender":       m.sender_id,
                "sender_name":  (m.sender.get_full_name() or m.sender.username) if m.sender else None,
                "sender_email": m.sender.email if m.sender else None,
                "body":         m.body,
                "is_staff_reply": m.is_staff_reply,
                "is_internal":  m.is_internal,
                "created_at":   m.created_at.isoformat(),
            }

        # -- Generator -----------------------------------------------------

        def event_stream():
            last_snapshot    = _ticket_snapshot(ticket)
            last_message_id  = (
                TicketMessage.objects.filter(ticket=ticket).order_by("-created_at")
                .values_list("id", flat=True).first() or 0
            )

            # Send initial connected event
            yield _sse_format("connected", _json.dumps({
                "ticket":    last_snapshot,
                "ticket_id": str(ticket.pk),
            }))

            heartbeat_counter = 0

            while True:
                time.sleep(1.5)

                # -- Heartbeat every ~15 s to keep the connection alive -----
                heartbeat_counter += 1
                if heartbeat_counter % 10 == 0:
                    yield _sse_heartbeat()

                # -- Check for ticket changes -------------------------------
                try:
                    t = Ticket.objects.select_related("assigned_to").get(pk=ticket_pk)
                except Ticket.DoesNotExist:
                    yield _sse_format("error", _json.dumps({"detail": "Ticket deleted."}))
                    return

                current_snapshot = _ticket_snapshot(t)
                if current_snapshot != last_snapshot:
                    last_snapshot = current_snapshot
                    yield _sse_format("ticket_update", _json.dumps(current_snapshot))

                # -- Check for new messages ---------------------------------
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

        response = StreamingHttpResponse(
            event_stream(),
            content_type="text/event-stream",
        )
        response["Cache-Control"]     = "no-cache"
        response["X-Accel-Buffering"] = "no"   # Disable Nginx buffering
        response["Access-Control-Allow-Origin"] = "*"
        return response
