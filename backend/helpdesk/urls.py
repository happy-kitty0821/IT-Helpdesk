from django.urls import path

from .views import ServiceCategoryList, TicketListCreate, health

urlpatterns = [
    path('health/', health, name='health'),
    path('services/', ServiceCategoryList.as_view(), name='service-list'),
    path('tickets/', TicketListCreate.as_view(), name='ticket-list-create'),
]
