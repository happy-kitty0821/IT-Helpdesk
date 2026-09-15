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
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import AccountRecoveryToken, EmailTemplate, GuideArticle, NotificationChannel, NotificationLog, NotificationRule, ServiceCategory, SoftwareResource, Ticket, TicketAttachment, TicketMessage
from .permissions import IsAdministrator, IsContentEditor, IsServiceLead
from .serializers import (
    AccountRecoveryTokenSerializer,
    AdminServiceCategorySerializer,
    EmailTemplateSerializer,
    GoogleCredentialSerializer,
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
        """
        import json as _json
        from django.http import QueryDict
        data = kwargs.pop('data', self.request.data)

        if isinstance(data, QueryDict):
            # Multipart/form-data: mutable copy so we can replace extra_fields
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
        roles = get_user_roles(self.request.user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        if roles.intersection(staff_roles):
            # Staff see all tickets (intern scope filtering restricts by category)
            qs = Ticket.objects.select_related('category', 'requester', 'assigned_to')
            if user_has_intern_scope_only(self.request.user):
                qs = qs.filter(category__slug__in=get_intern_scope_slugs())
            return qs
        # Regular users see only their own tickets
        return Ticket.objects.filter(requester=self.request.user).select_related('category', 'assigned_to')

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
        roles = get_user_roles(self.request.user)
        staff_roles = {'administrator', 'service_lead', 'it_agent', 'it_noc_intern',
                       'content_editor', 'designated_approver'}
        qs = Ticket.objects.select_related('category', 'requester', 'assigned_to')
        if roles.intersection(staff_roles):
            # Staff can access all tickets (with intern scope restriction)
            if user_has_intern_scope_only(self.request.user):
                qs = qs.filter(category__slug__in=get_intern_scope_slugs())
        else:
            # Regular users can only access their own tickets
            qs = qs.filter(requester=self.request.user)
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
    permission_classes = (IsServiceLead,)

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


class AdminUserList(generics.ListAPIView):
    permission_classes = (IsAdministrator,)
    pagination_class = None
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
