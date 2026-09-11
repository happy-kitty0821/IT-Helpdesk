from django.urls import path, re_path

from .views import (
    CsrfView,
    CurrentUserView,
    GoogleLoginView,
    LoginView,
    LogoutView,
    RegisterView,
    ServiceCategoryList,
    TicketListCreate,
    health,
)

urlpatterns = [
    path('health/', health, name='health'),
    re_path(r'^auth/csrf/?$', CsrfView.as_view(), name='auth-csrf'),
    re_path(r'^auth/me/?$', CurrentUserView.as_view(), name='auth-me'),
    re_path(r'^auth/register/?$', RegisterView.as_view(), name='auth-register'),
    re_path(r'^auth/login/?$', LoginView.as_view(), name='auth-login'),
    re_path(r'^auth/google/?$', GoogleLoginView.as_view(), name='auth-google'),
    re_path(r'^auth/logout/?$', LogoutView.as_view(), name='auth-logout'),
    path('services/', ServiceCategoryList.as_view(), name='service-list'),
    path('tickets/', TicketListCreate.as_view(), name='ticket-list-create'),
]
