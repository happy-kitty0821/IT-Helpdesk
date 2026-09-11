from rest_framework import serializers

from .models import ServiceCategory, Ticket


class ServiceCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceCategory
        fields = ('id', 'name', 'slug', 'summary', 'audience', 'icon')


class TicketSerializer(serializers.ModelSerializer):
    reference = serializers.CharField(read_only=True)
    requester = serializers.PrimaryKeyRelatedField(read_only=True)
    status = serializers.CharField(read_only=True)

    class Meta:
        model = Ticket
        fields = (
            'id', 'reference', 'requester', 'category', 'subject', 'description',
            'status', 'priority', 'created_at', 'updated_at',
        )

    def validate_subject(self, value):
        value = value.strip()
        if len(value) < 5:
            raise serializers.ValidationError('Use at least 5 characters.')
        return value

    def validate_description(self, value):
        value = value.strip()
        if len(value) < 20:
            raise serializers.ValidationError('Describe the issue in at least 20 characters.')
        return value

    def create(self, validated_data):
        return Ticket.objects.create(requester=self.context['request'].user, **validated_data)
