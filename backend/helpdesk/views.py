from django.http import JsonResponse
from rest_framework import generics, permissions

from .models import ServiceCategory, Ticket
from .serializers import ServiceCategorySerializer, TicketSerializer


def health(request):
    return JsonResponse({'status': 'ok', 'service': 'iic-helpdesk-api'})


class ServiceCategoryList(generics.ListAPIView):
    permission_classes = (permissions.AllowAny,)
    pagination_class = None
    serializer_class = ServiceCategorySerializer
    queryset = ServiceCategory.objects.filter(is_active=True)


class TicketListCreate(generics.ListCreateAPIView):
    serializer_class = TicketSerializer

    def get_queryset(self):
        return Ticket.objects.filter(requester=self.request.user).select_related('category')
