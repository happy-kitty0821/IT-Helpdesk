from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import GuideArticle, ServiceCategory, SoftwareResource, Ticket


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


class GuideArticleSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()
    pdf_file = serializers.FileField(write_only=True, required=False)
    pdf_url = serializers.SerializerMethodField()
    pdf_name = serializers.SerializerMethodField()
    pdf_size = serializers.SerializerMethodField()

    class Meta:
        model = GuideArticle
        fields = (
            'id', 'title', 'slug', 'summary', 'pdf_file', 'pdf_url', 'pdf_name',
            'pdf_size', 'audience', 'tags',
            'status', 'reviewed_at', 'created_by_name', 'updated_by_name',
            'created_at', 'updated_at',
        )
        read_only_fields = ('created_by_name', 'updated_by_name', 'created_at', 'updated_at')

    def validate_tags(self, value):
        if not isinstance(value, list) or len(value) > 12:
            raise serializers.ValidationError('Provide up to 12 tags.')
        cleaned = []
        for tag in value:
            if not isinstance(tag, str) or not tag.strip() or len(tag.strip()) > 40:
                raise serializers.ValidationError('Each tag must be text between 1 and 40 characters.')
            cleaned.append(tag.strip().lower())
        return list(dict.fromkeys(cleaned))

    def validate_pdf_file(self, value):
        if value.size > 15 * 1024 * 1024:
            raise serializers.ValidationError('PDF files must be 15 MB or smaller.')
        if not value.name.lower().endswith('.pdf'):
            raise serializers.ValidationError('Upload a file with a .pdf extension.')
        signature = value.read(5)
        value.seek(0)
        if signature != b'%PDF-':
            raise serializers.ValidationError('The uploaded file is not a valid PDF.')
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get('pdf_file'):
            raise serializers.ValidationError({'pdf_file': 'A PDF guide is required.'})
        return attrs

    def update(self, instance, validated_data):
        old_file = instance.pdf_file
        replacement = validated_data.get('pdf_file')
        instance = super().update(instance, validated_data)
        if replacement and old_file and old_file.name != instance.pdf_file.name:
            old_file.delete(save=False)
        return instance

    def get_pdf_url(self, obj):
        return obj.pdf_file.url if obj.pdf_file else None

    def get_pdf_name(self, obj):
        return obj.pdf_file.name.rsplit('/', 1)[-1] if obj.pdf_file else None

    def get_pdf_size(self, obj):
        if not obj.pdf_file:
            return 0
        try:
            return obj.pdf_file.size
        except OSError:
            return 0

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.username if obj.updated_by else None


class AdminUserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = (
            'id', 'username', 'email', 'first_name', 'last_name', 'name',
            'is_active', 'is_staff', 'is_superuser', 'date_joined', 'last_login',
        )
        read_only_fields = ('username', 'email', 'name', 'date_joined', 'last_login')

    def get_name(self, obj):
        return obj.get_full_name() or obj.username

    def validate(self, attrs):
        request = self.context.get('request')
        if request and self.instance == request.user:
            if attrs.get('is_active') is False:
                raise serializers.ValidationError({'is_active': 'You cannot deactivate your own account.'})
            if attrs.get('is_superuser') is False:
                raise serializers.ValidationError({'is_superuser': 'You cannot remove your own superuser access.'})
        return attrs


class SoftwareResourceSerializer(serializers.ModelSerializer):
    guide_title = serializers.CharField(source='guide.title', read_only=True)
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SoftwareResource
        fields = (
            'id', 'name', 'slug', 'description', 'version', 'platforms',
            'audience', 'licence_notes', 'download_url', 'guide', 'guide_title',
            'status', 'updated_by_name', 'created_at', 'updated_at',
        )
        read_only_fields = ('guide_title', 'updated_by_name', 'created_at', 'updated_at')

    def validate_platforms(self, value):
        allowed = {'Windows', 'macOS', 'Linux', 'Web', 'Android', 'iOS'}
        if not isinstance(value, list) or not value or len(value) > 6:
            raise serializers.ValidationError('Choose between 1 and 6 platforms.')
        if any(platform not in allowed for platform in value):
            raise serializers.ValidationError('One or more platforms are not supported.')
        return list(dict.fromkeys(value))

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.username if obj.updated_by else None
