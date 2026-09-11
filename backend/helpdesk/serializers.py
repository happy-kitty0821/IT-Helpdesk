from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import ServiceCategory, Ticket


def email_domain_allowed(email):
    try:
        domain = email.rsplit('@', 1)[1].lower()
    except IndexError:
        return False
    return domain in settings.ALLOWED_REGISTRATION_DOMAINS


class UserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = ('id', 'username', 'email', 'name', 'is_staff', 'is_superuser')

    def get_name(self, obj):
        return obj.get_full_name() or obj.username


class RegistrationSerializer(serializers.Serializer):
    username = serializers.RegexField(r'^[A-Za-z0-9._-]+$', min_length=3, max_length=150)
    email = serializers.EmailField()
    first_name = serializers.CharField(min_length=1, max_length=150)
    last_name = serializers.CharField(min_length=1, max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_username(self, value):
        if get_user_model().objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('This username is already in use.')
        return value

    def validate_email(self, value):
        value = value.lower()
        if not email_domain_allowed(value):
            domains = ', '.join(f'@{domain}' for domain in settings.ALLOWED_REGISTRATION_DOMAINS)
            raise serializers.ValidationError(f'Use an approved college email: {domains}.')
        if get_user_model().objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account already exists for this email.')
        return value

    def validate(self, attrs):
        try:
            validate_password(attrs['password'])
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': list(exc.messages)}) from exc
        return attrs

    def create(self, validated_data):
        return get_user_model().objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class GoogleCredentialSerializer(serializers.Serializer):
    credential = serializers.CharField(trim_whitespace=False)


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
