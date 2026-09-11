from django.contrib import admin

from .models import ServiceCategory, Ticket


@admin.register(ServiceCategory)
class ServiceCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'audience', 'is_active', 'sort_order')
    list_filter = ('audience', 'is_active')
    prepopulated_fields = {'slug': ('name',)}
    ordering = ('sort_order', 'name')


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ('reference', 'subject', 'category', 'status', 'priority', 'created_at')
    list_filter = ('status', 'priority', 'category')
    search_fields = ('reference', 'subject', 'requester__email')
    readonly_fields = ('reference', 'created_at', 'updated_at')
