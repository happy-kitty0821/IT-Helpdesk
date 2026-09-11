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

from .models import GuideArticle, ServiceCategory, SoftwareResource, Ticket
from .serializers import (
    GoogleCredentialSerializer,
    LoginSerializer,
    RegistrationSerializer,
    ServiceCategorySerializer,
    SoftwareResourceSerializer,
    TicketSerializer,
    UserSerializer,
    AdminUserSerializer,
    GuideArticleSerializer,
    email_domain_allowed,
)


def health(request):
    return JsonResponse({'status': 'ok', 'service': 'iic-helpdesk-api'})


class CsrfView(APIView):
    authentication_classes = ()
    permission_classes = (permissions.AllowAny,)

    def get(self, request):
        return Response({'csrfToken': get_token(request)})


class CurrentUserView(APIView):
    def get(self, request):
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
    queryset = ServiceCategory.objects.filter(is_active=True)


class TicketListCreate(generics.ListCreateAPIView):
    serializer_class = TicketSerializer

    def get_queryset(self):
        return Ticket.objects.filter(requester=self.request.user).select_related('category')


class IsSuperuser(permissions.BasePermission):
    message = 'Superuser access is required.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


class PublicGuideList(generics.ListAPIView):
    permission_classes = (permissions.AllowAny,)
    pagination_class = None
    serializer_class = GuideArticleSerializer
    queryset = GuideArticle.objects.filter(
        status=GuideArticle.Status.PUBLISHED,
        audience=ServiceCategory.Audience.PUBLIC,
    ).select_related('created_by', 'updated_by')


class PublicSoftwareList(generics.ListAPIView):
    permission_classes = (permissions.AllowAny,)
    pagination_class = None
    serializer_class = SoftwareResourceSerializer
    queryset = SoftwareResource.objects.filter(
        status=SoftwareResource.Status.ACTIVE,
        audience=ServiceCategory.Audience.PUBLIC,
    ).select_related('guide', 'updated_by')


class AdminGuideListCreate(generics.ListCreateAPIView):
    permission_classes = (IsSuperuser,)
    parser_classes = (MultiPartParser, FormParser, JSONParser)
    serializer_class = GuideArticleSerializer
    queryset = GuideArticle.objects.select_related('created_by', 'updated_by')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)


class AdminGuideDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsSuperuser,)
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
    permission_classes = (IsSuperuser,)
    serializer_class = SoftwareResourceSerializer
    queryset = SoftwareResource.objects.select_related('guide', 'updated_by')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)


class AdminSoftwareDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsSuperuser,)
    serializer_class = SoftwareResourceSerializer
    queryset = SoftwareResource.objects.select_related('guide', 'updated_by')

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class AdminUserList(generics.ListAPIView):
    permission_classes = (IsSuperuser,)
    pagination_class = None
    serializer_class = AdminUserSerializer

    def get_queryset(self):
        queryset = get_user_model().objects.order_by('-is_superuser', '-is_staff', 'first_name', 'username')
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
    permission_classes = (IsSuperuser,)
    serializer_class = AdminUserSerializer
    queryset = get_user_model().objects.all()


class AdminSummaryView(APIView):
    permission_classes = (IsSuperuser,)

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
