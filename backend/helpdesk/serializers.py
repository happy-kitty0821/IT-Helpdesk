from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import GuideArticle, RoleGrant, ServiceCategory, SoftwareResource, Ticket


def email_domain_allowed(email):
    try:
        domain = email.rsplit('@', 1)[1].lower()
    except IndexError:
        return False
    return domain in settings.ALLOWED_REGISTRATION_DOMAINS


class UserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    category_scope = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = ('id', 'username', 'email', 'name', 'is_staff', 'is_superuser', 'roles', 'category_scope')

    def get_name(self, obj):
        return obj.get_full_name() or obj.username

    def get_roles(self, obj):
        from helpdesk.permissions import get_user_roles
        return sorted(get_user_roles(obj))

    def get_category_scope(self, obj):
        from helpdesk.permissions import get_intern_scope_slugs, user_has_intern_scope_only
        if user_has_intern_scope_only(obj):
            return get_intern_scope_slugs()
        return None


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
        fields = ('id', 'name', 'slug', 'summary', 'audience', 'icon', 'form_schema')


class AdminServiceCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceCategory
        fields = (
            'id', 'name', 'slug', 'summary', 'audience', 'icon',
            'sort_order', 'is_active', 'form_schema',
        )

    def validate_form_schema(self, value):
        from .validators import validate_form_schema
        validate_form_schema(value)
        return value


class TicketSerializer(serializers.ModelSerializer):
    reference = serializers.CharField(read_only=True)
    requester = serializers.PrimaryKeyRelatedField(read_only=True)
    status = serializers.CharField(read_only=True)
    assigned_to = serializers.PrimaryKeyRelatedField(read_only=True)
    team = serializers.CharField(read_only=True)
    assignee_name = serializers.SerializerMethodField()
    extra_fields = serializers.JSONField(default=dict)

    class Meta:
        model = Ticket
        fields = (
            'id', 'reference', 'requester', 'category', 'subject', 'description',
            'status', 'priority', 'assigned_to', 'team', 'assignee_name',
            'extra_fields', 'created_at', 'updated_at',
        )

    def get_assignee_name(self, obj):
        if obj.assigned_to:
            return obj.assigned_to.get_full_name() or obj.assigned_to.username
        return None

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

    def validate(self, attrs):
        category = attrs.get('category') or (self.instance.category if self.instance else None)
        extra_fields = attrs.get('extra_fields', {})
        if category and hasattr(category, 'form_schema'):
            from .validators import validate_extra_fields
            validate_extra_fields(extra_fields, category.form_schema)
        return attrs

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        if rep.get('extra_fields') is None:
            rep['extra_fields'] = {}
        return rep

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
        if not obj.pdf_file:
            return None
        url = obj.pdf_file.url
        request = self.context.get("request")
        if request is not None:
            return request.build_absolute_uri(url)
        return url

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
    roles = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = (
            'id', 'username', 'email', 'first_name', 'last_name', 'name',
            'is_active', 'is_staff', 'is_superuser', 'date_joined', 'last_login',
            'roles',
        )
        read_only_fields = ('username', 'email', 'name', 'date_joined', 'last_login')

    def get_name(self, obj):
        return obj.get_full_name() or obj.username

    def get_roles(self, obj):
        from django.utils import timezone
        # Use prefetched data when available to avoid N+1 queries.
        if hasattr(obj, '_prefetched_objects_cache') and 'rolegrant_set' in obj._prefetched_objects_cache:
            now = timezone.now()
            grants = obj._prefetched_objects_cache['rolegrant_set']
            return sorted(
                g.role for g in grants
                if g.expires_at is None or g.expires_at > now
            )
        # Fallback: hit the database directly.
        from helpdesk.permissions import get_user_roles
        return sorted(get_user_roles(obj))

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


class RoleGrantSerializer(serializers.ModelSerializer):
    granted_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RoleGrant
        fields = ('id', 'role', 'granted_by', 'granted_by_name', 'granted_at', 'expires_at')
        read_only_fields = ('id', 'granted_by', 'granted_by_name', 'granted_at')

    def validate_role(self, value):
        from helpdesk.models import RoleChoices
        valid_values = {c[0] for c in RoleChoices.choices}
        if value not in valid_values:
            raise serializers.ValidationError(f"Value '{value}' is not a valid choice.")
        return value

    def validate_expires_at(self, value):
        if value is not None:
            from django.utils import timezone
            if value <= timezone.now():
                raise serializers.ValidationError('expires_at must be a future datetime.')
        return value

    def get_granted_by_name(self, obj):
        if obj.granted_by:
            return obj.granted_by.get_full_name() or obj.granted_by.username
        return None
