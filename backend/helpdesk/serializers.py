from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import AccountRecoveryToken, Announcement, EmailTemplate, GuideArticle, NotificationChannel, NotificationLog, NotificationRule, RoleConfig, RoleGrant, ServiceCategory, ServiceStatus, SiteSettings, SoftwareResource, Ticket, TicketAttachment, TicketFeedback, TicketFormSettings, TicketMessage


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
    is_suspended = serializers.SerializerMethodField()
    suspension_reason = serializers.SerializerMethodField()
    email_verified = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = ('id', 'username', 'email', 'name', 'is_staff', 'is_superuser',
                  'roles', 'category_scope', 'is_suspended', 'suspension_reason',
                  'email_verified', 'avatar_url')

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

    def get_is_suspended(self, obj):
        try:
            return obj.profile.is_suspended
        except Exception:
            return False

    def get_suspension_reason(self, obj):
        try:
            return obj.profile.suspension_reason if obj.profile.is_suspended else ''
        except Exception:
            return ''
    def get_email_verified(self, obj):
        try:
            return obj.profile.email_verified
        except Exception:
            return False

    def get_avatar_url(self, obj):
        try:
            return obj.profile.avatar_url or ''
        except Exception:
            return ''

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
        fields = ('id', 'name', 'slug', 'summary', 'audience', 'icon', 'form_schema', 'stages')


class AdminServiceCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceCategory
        fields = (
            'id', 'name', 'slug', 'summary', 'audience', 'icon',
            'sort_order', 'is_active', 'form_schema', 'stages',
        )

    def validate_form_schema(self, value):
        from .validators import validate_form_schema
        validate_form_schema(value)
        return value


class TicketSerializer(serializers.ModelSerializer):
    reference = serializers.CharField(read_only=True)
    requester = serializers.PrimaryKeyRelatedField(read_only=True)
    requester_name = serializers.SerializerMethodField()
    requester_email = serializers.SerializerMethodField()
    status = serializers.CharField(read_only=True)
    assigned_to = serializers.PrimaryKeyRelatedField(read_only=True)
    team = serializers.CharField(read_only=True)
    assignee_name = serializers.SerializerMethodField()
    category_name = serializers.SerializerMethodField()
    category_slug = serializers.SerializerMethodField()
    extra_fields = serializers.JSONField(default=dict)
    elapsed = serializers.SerializerMethodField()
    status_reason = serializers.CharField(read_only=True)
    current_stage = serializers.CharField(read_only=True)
    # Declared explicitly so DRF does not infer allow_blank=False from the model.
    # Our validate_description() reads TicketFormSettings to decide whether blank is ok.
    description = serializers.CharField(allow_blank=True, required=False, default='')
    subject = serializers.CharField(allow_blank=True, required=False, default='')

    class Meta:
        model = Ticket
        fields = (
            'id', 'reference', 'requester', 'requester_name', 'requester_email',
            'category', 'category_name', 'category_slug', 'subject', 'description',
            'status', 'status_reason', 'priority',
            'assigned_to', 'team', 'assignee_name',
            'extra_fields', 'elapsed', 'created_at', 'updated_at',
            'current_stage',
        )

    def get_requester_name(self, obj):
        if obj.requester:
            return obj.requester.get_full_name() or obj.requester.username
        return None

    def get_requester_email(self, obj):
        return obj.requester.email if obj.requester else None

    def get_assignee_name(self, obj):
        if obj.assigned_to:
            return obj.assigned_to.get_full_name() or obj.assigned_to.username
        return None

    def get_category_name(self, obj):
        return obj.category.name if obj.category else None

    def get_category_slug(self, obj):
        return obj.category.slug if obj.category else None

    def get_elapsed(self, obj):
        """Return a human-readable elapsed time string since ticket was created."""
        from django.utils import timezone
        delta = timezone.now() - obj.created_at
        seconds = int(delta.total_seconds())
        if seconds < 60:
            return 'just now'
        minutes = seconds // 60
        if minutes < 60:
            return f'{minutes} minute{"s" if minutes != 1 else ""} ago'
        hours = minutes // 60
        if hours < 24:
            return f'{hours} hour{"s" if hours != 1 else ""} ago'
        days = hours // 24
        if days < 30:
            return f'{days} day{"s" if days != 1 else ""} ago'
        months = days // 30
        if months < 12:
            return f'{months} month{"s" if months != 1 else ""} ago'
        years = months // 12
        return f'{years} year{"s" if years != 1 else ""} ago'

    def validate_subject(self, value):
        value = value.strip()
        settings = TicketFormSettings.get()
        # Blank subject is always allowed here — perform_create auto-fills it
        # from the category name when the field is hidden or empty.
        if not value:
            return value
        if settings.subject_required and len(value) < settings.subject_min_len:
            raise serializers.ValidationError(
                f'Use at least {settings.subject_min_len} characters.'
            )
        if len(value) > settings.subject_max_len:
            raise serializers.ValidationError(
                f'Subject must be {settings.subject_max_len} characters or fewer.'
            )
        return value

    def validate_description(self, value):
        value = value.strip()
        settings = TicketFormSettings.get()
        # If description is not required or is blank, allow it through.
        if not settings.description_required or not value:
            return value
        if len(value) < settings.description_min_len:
            raise serializers.ValidationError(
                f'Describe the issue in at least {settings.description_min_len} characters.'
            )
        if len(value) > settings.description_max_len:
            raise serializers.ValidationError(
                f'Description must be {settings.description_max_len} characters or fewer.'
            )
        return value

    def validate(self, attrs):
        category = attrs.get('category') or (self.instance.category if self.instance else None)
        extra_fields = attrs.get('extra_fields', {})
        if category and hasattr(category, 'form_schema'):
            from .validators import validate_extra_fields
            # file_keys are passed via serializer context from the view
            file_keys = set(self.context.get('file_keys', []))
            validate_extra_fields(extra_fields, category.form_schema, file_keys=file_keys)
        return attrs

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        if rep.get('extra_fields') is None:
            rep['extra_fields'] = {}
        return rep


class TicketUpdateSerializer(serializers.ModelSerializer):
    """Staff-facing partial update: subject, description, priority, status, assigned_to."""
    assigned_to = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.filter(is_active=True),
        allow_null=True,
        required=False,
    )
    # Allow blank so DRF doesn't reject empty strings before validate_description runs.
    description = serializers.CharField(allow_blank=True, required=False, default='')
    subject = serializers.CharField(allow_blank=True, required=False, default='')

    class Meta:
        model = Ticket
        fields = ('subject', 'description', 'priority', 'status', 'team', 'assigned_to', 'current_stage')

    def validate_subject(self, value):
        value = value.strip()
        settings = TicketFormSettings.get()
        if settings.subject_required and len(value) < settings.subject_min_len:
            raise serializers.ValidationError(
                f'Use at least {settings.subject_min_len} characters.'
            )
        if len(value) > settings.subject_max_len:
            raise serializers.ValidationError(
                f'Subject must be {settings.subject_max_len} characters or fewer.'
            )
        return value

    def validate_description(self, value):
        value = value.strip()
        settings = TicketFormSettings.get()
        if not settings.description_required and not value:
            return value
        if settings.description_required and len(value) < settings.description_min_len:
            raise serializers.ValidationError(
                f'Describe the issue in at least {settings.description_min_len} characters.'
            )
        if value and len(value) > settings.description_max_len:
            raise serializers.ValidationError(
                f'Description must be {settings.description_max_len} characters or fewer.'
            )
        return value


class TicketStatusSerializer(serializers.Serializer):
    """Used for the POST /tickets/{id}/status/ transition endpoint."""
    status = serializers.ChoiceField(choices=Ticket.Status.choices)
    reason = serializers.CharField(max_length=1000, required=False, allow_blank=True)


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
        """Return the raw relative path; frontend resolves it via NEXT_PUBLIC_DJANGO_URL."""
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
    roles = serializers.SerializerMethodField()
    is_suspended = serializers.SerializerMethodField()
    suspension_reason = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = (
            'id', 'username', 'email', 'first_name', 'last_name', 'name',
            'is_active', 'is_staff', 'is_superuser', 'date_joined', 'last_login',
            'roles', 'is_suspended', 'suspension_reason', 'avatar_url',
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

    def get_is_suspended(self, obj):
        try:
            return obj.profile.is_suspended
        except Exception:
            return False

    def get_suspension_reason(self, obj):
        try:
            return obj.profile.suspension_reason if obj.profile.is_suspended else ''
        except Exception:
            return ''

    def get_avatar_url(self, obj):
        try:
            return obj.profile.avatar_url or ''
        except Exception:
            return ''

    def validate(self, attrs):
        request = self.context.get('request')
        if request and self.instance == request.user:
            if attrs.get('is_active') is False:
                raise serializers.ValidationError({'is_active': 'You cannot deactivate your own account.'})
            if attrs.get('is_superuser') is False:
                raise serializers.ValidationError({'is_superuser': 'You cannot remove your own superuser access.'})
        return attrs



class AdminUserCreateSerializer(serializers.Serializer):
    """Validates manual user creation from the admin panel."""
    email            = serializers.EmailField()
    username         = serializers.CharField(max_length=150)
    first_name       = serializers.CharField(max_length=150, allow_blank=True, default='')
    last_name        = serializers.CharField(max_length=150, allow_blank=True, default='')
    password         = serializers.CharField(
        min_length=8, max_length=128,
        allow_blank=True, default='',
        write_only=True,
        help_text='Leave blank to create an account without a password (SSO only).',
    )
    confirm_password = serializers.CharField(
        min_length=8, max_length=128,
        allow_blank=True, default='',
        write_only=True,
    )

    def validate_email(self, value):
        User = get_user_model()
        value = value.lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def validate_username(self, value):
        User = get_user_model()
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('A user with this username already exists.')
        import re
        if not re.match(r'^[\w.@+-]+$', value):
            raise serializers.ValidationError(
                'Enter a valid username. Only letters, digits and @/./+/-/_ are allowed.'
            )
        return value

    def validate(self, attrs):
        password = attrs.get('password', '').strip()
        confirm  = attrs.get('confirm_password', '').strip()
        if password:
            if password != confirm:
                raise serializers.ValidationError(
                    {'confirm_password': 'Passwords do not match.'}
                )
            # Run Django password validators
            from django.contrib.auth.password_validation import validate_password
            from django.core.exceptions import ValidationError as DjangoValidationError
            try:
                validate_password(password)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({'password': list(exc.messages)})
        return attrs

    def create(self, validated_data):
        User = get_user_model()
        password = validated_data.get('password', '').strip()
        user = User(
            email=validated_data['email'],
            username=validated_data['username'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            is_active=True,
        )
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user


class SoftwareResourceSerializer(serializers.ModelSerializer):
    guide_title = serializers.CharField(source='guide.title', read_only=True)
    updated_by_name = serializers.SerializerMethodField()
    # Write-only: accepts a multipart file upload.  Optional — leave blank
    # to keep using the external download_url instead.
    file = serializers.FileField(write_only=True, required=False, allow_null=True)
    # Write-only: path relative to MEDIA_ROOT produced by FinalizeChunkedUploadView.
    # Used when the file was uploaded via the chunked protocol instead of direct upload.
    file_path = serializers.CharField(
        write_only=True, required=False, allow_blank=True, allow_null=True,
    )
    # Write-only: when True, removes the existing uploaded file.
    remove_file = serializers.BooleanField(write_only=True, required=False, default=False)
    # Read-only: derived file metadata for the frontend.
    file_url  = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()

    # 25 GB hard limit enforced in the serializer as a second line of
    # defence behind Django's DATA_UPLOAD_MAX_MEMORY_SIZE.
    MAX_FILE_SIZE = 25 * 1024 * 1024 * 1024  # 25 GB

    class Meta:
        model = SoftwareResource
        fields = (
            'id', 'name', 'slug', 'description', 'version', 'platforms',
            'audience', 'licence_notes', 'download_url',
            'file', 'file_path', 'remove_file', 'file_url', 'file_name', 'file_size',
            'guide', 'guide_title',
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

    def validate_file(self, value):
        """Validate the uploaded installer file."""
        if value is None:
            return value
        if value.size > self.MAX_FILE_SIZE:
            raise serializers.ValidationError(
                f'File is too large ({value.size / (1024**3):.1f} GB). '
                f'Maximum allowed size is 25 GB.'
            )
        return value

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.username if obj.updated_by else None

    def get_file_url(self, obj):
        """
        Return the gated download URL (/api/v1/software/{slug}/download/)
        instead of the raw /media/ path.  The download view enforces
        authentication + audience checks before streaming the file.
        """
        if not obj.file:
            return None
        request = self.context.get('request')
        path = f'/api/v1/software/{obj.slug}/download/'
        if request:
            return request.build_absolute_uri(path)
        return path

    def get_file_name(self, obj):
        if obj.file:
            return obj.file.name.rsplit('/', 1)[-1]
        return None

    def get_file_size(self, obj):
        if not obj.file:
            return 0
        try:
            return obj.file.size
        except OSError:
            return 0

    def update(self, instance, validated_data):
        """Handle file replacement — direct upload or chunked-upload path."""
        import os
        from django.conf import settings as _s
        from django.core.files import File

        new_file    = validated_data.pop('file',        None)
        file_path   = validated_data.pop('file_path',   None)
        remove_file = validated_data.pop('remove_file', False)

        old_file = instance.file if instance.file else None

        # If a chunked-upload final_path was supplied, open it as a Django File
        if file_path and not new_file:
            abs_path = os.path.join(_s.MEDIA_ROOT, file_path.lstrip('/'))
            if os.path.exists(abs_path):
                # Wrap in a Django File object so the storage backend records
                # the path correctly.  We open in 'rb' and let Django copy it.
                _fh = open(abs_path, 'rb')
                new_file = File(_fh, name=os.path.basename(abs_path))

        instance = super().update(instance, validated_data)

        if new_file is not None:
            instance.file = new_file
            instance.save(update_fields=['file'])
            # Close the handle if we opened it ourselves (chunked path)
            if hasattr(new_file, 'close'):
                try:
                    new_file.close()
                except Exception:
                    pass
            if old_file and old_file.name != instance.file.name:
                old_file.delete(save=False)
        elif remove_file:
            instance.file = None
            instance.save(update_fields=['file'])
            if old_file:
                old_file.delete(save=False)

        return instance


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


class NotificationChannelSerializer(serializers.ModelSerializer):
    config_display = serializers.SerializerMethodField()

    class Meta:
        model = NotificationChannel
        fields = ('id', 'type', 'name', 'is_active', 'config', 'config_display', 'created_at', 'updated_at')
        extra_kwargs = {'config': {'write_only': True}}

    def get_config_display(self, obj):
        from .notifications import mask_config
        return mask_config(obj.type, obj.config)

    def validate(self, attrs):
        channel_type = attrs.get('type') or (self.instance.type if self.instance else None)
        config = attrs.get('config', {})

        # For updates, merge with stored config (handles masked secrets)
        if self.instance and 'config' in attrs:
            from .notifications import merge_config
            config = merge_config(channel_type, self.instance.config, config)
            attrs['config'] = config

        required = {
            'discord': ['webhook_url'],
            'google_workspace': ['webhook_url'],
            'teams': ['webhook_url'],
            'slack': ['webhook_url'],
            'email_smtp': ['host', 'port', 'username', 'password', 'from_email'],
            'email_mailgun': ['api_url', 'api_key', 'from_email', 'domain'],
        }
        if channel_type and 'config' in attrs:
            for field in required.get(channel_type, []):
                if not config.get(field):
                    raise serializers.ValidationError({
                        'config': f'Field "{field}" is required for {channel_type} channels.'
                    })
        return attrs


class EmailTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailTemplate
        fields = ('id', 'event_type', 'name', 'subject_template', 'body_html_template',
                  'is_active', 'created_at', 'updated_at')


class NotificationLogSerializer(serializers.ModelSerializer):
    channel_name = serializers.CharField(source='channel.name', read_only=True, default='')

    class Meta:
        model = NotificationLog
        fields = ('id', 'channel', 'channel_name', 'event_type', 'ticket', 'status',
                  'error_message', 'sent_at')
        read_only_fields = fields


class NotificationRuleSerializer(serializers.ModelSerializer):
    channel_name = serializers.CharField(source='channel.name', read_only=True)
    channel_type = serializers.CharField(source='channel.type', read_only=True)
    channel_emoji = serializers.SerializerMethodField()

    class Meta:
        model = NotificationRule
        fields = (
            'id', 'event_type', 'channel', 'channel_name', 'channel_type',
            'channel_emoji', 'is_active', 'recipient_type', 'custom_emails',
            'created_at', 'updated_at',
        )

    def get_channel_emoji(self, obj) -> str:
        emoji_map = {
            'discord': '??',
            'google_workspace': '??',
            'teams': '??',
            'slack': '??',
            'email_smtp': '??',
            'email_mailgun': '??',
        }
        return emoji_map.get(obj.channel.type, '??')


class TicketMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    sender_email = serializers.SerializerMethodField()

    class Meta:
        model = TicketMessage
        fields = (
            'id', 'ticket', 'sender', 'sender_name', 'sender_email',
            'body', 'is_staff_reply', 'is_internal', 'created_at',
        )
        read_only_fields = ('id', 'ticket', 'sender', 'sender_name', 'sender_email',
                            'is_staff_reply', 'created_at')

    def get_sender_name(self, obj):
        if obj.sender:
            return obj.sender.get_full_name() or obj.sender.username
        return 'System'

    def get_sender_email(self, obj):
        return obj.sender.email if obj.sender else None


class AccountRecoveryTokenSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountRecoveryToken
        fields = ('id', 'ticket', 'backup_code', 'is_used', 'created_at')
        read_only_fields = ('id', 'ticket', 'backup_code', 'is_used', 'created_at')


class TicketAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = TicketAttachment
        fields = ('id', 'ticket', 'field_key', 'original_name', 'content_type',
                  'file_size', 'file_url', 'created_at')
        read_only_fields = fields

    def get_file_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url if obj.file else None


class RoleConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoleConfig
        fields = ('role', 'is_grantable', 'can_export', 'description', 'updated_at')
        read_only_fields = ('role', 'updated_at')


class TicketFormSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketFormSettings
        fields = (
            'subject_visible', 'subject_required', 'subject_min_len', 'subject_max_len',
            'description_visible', 'description_required', 'description_min_len', 'description_max_len',
            'impact_visible', 'impact_required',
            'updated_at',
        )
        read_only_fields = ('updated_at',)

    def validate(self, attrs):
        for field in ('subject', 'description'):
            min_key = f'{field}_min_len'
            max_key = f'{field}_max_len'
            mn = attrs.get(min_key, getattr(self.instance, min_key, 0) if self.instance else 0)
            mx = attrs.get(max_key, getattr(self.instance, max_key, 1) if self.instance else 1)
            if mn >= mx:
                raise serializers.ValidationError(
                    {max_key: f'{field} max length must be greater than min length.'}
                )
        return attrs


# ---------------------------------------------------------------------------
# Site settings serializer
# ---------------------------------------------------------------------------

class SiteSettingsSerializer(serializers.ModelSerializer):
    """
    Serializer for the SiteSettings singleton.

    The public endpoint exposes all fields read-only.
    The admin PATCH endpoint allows updating all writable fields.
    """

    class Meta:
        model = SiteSettings
        fields = (
            'support_email', 'office_location', 'office_phone',
            'office_hours',
            'walk_in_note', 'accessibility_note', 'account_recovery_note',
            'institution_name', 'department_name', 'helpdesk_tagline',
            'recovery_credentials_destination',
            'updated_at',
        )
        read_only_fields = ('updated_at',)

    def validate_office_hours(self, value):
        """
        Validate that office_hours is a list of {day: str, hours: str} dicts.
        Allows an empty list (meaning: use frontend defaults).
        """
        if not isinstance(value, list):
            raise serializers.ValidationError('office_hours must be a list.')
        for i, item in enumerate(value):
            if not isinstance(item, dict):
                raise serializers.ValidationError(f'Item {i} must be an object.')
            if 'day' not in item or 'hours' not in item:
                raise serializers.ValidationError(
                    f'Item {i} must have "day" and "hours" keys.'
                )
            if not isinstance(item['day'], str) or not isinstance(item['hours'], str):
                raise serializers.ValidationError(
                    f'Item {i}: "day" and "hours" must be strings.'
                )
        return value


# ---------------------------------------------------------------------------
# Announcement serializers
# ---------------------------------------------------------------------------

class AnnouncementSerializer(serializers.ModelSerializer):
    """Read-only public serializer — serves the active announcement."""
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            'id', 'campaign_id', 'title', 'body', 'image_url',
            'alt_text', 'link_url', 'audience', 'priority',
            'is_active', 'scheduled_start', 'scheduled_end', 'updated_at',
        )
        read_only_fields = fields

    def get_image_url(self, obj):
        return obj.image.url if obj.image else None


class AnnouncementAdminSerializer(serializers.ModelSerializer):
    """Full read/write serializer for the admin panel."""
    image_url = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            'id', 'campaign_id', 'title', 'body', 'image', 'image_url',
            'alt_text', 'link_url', 'audience', 'priority', 'owner', 'owner_name',
            'is_active', 'scheduled_start', 'scheduled_end',
            'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'image_url', 'owner_name', 'created_at', 'updated_at')

    def get_image_url(self, obj):
        return obj.image.url if obj.image else None

    def get_owner_name(self, obj):
        if obj.owner:
            return obj.owner.get_full_name() or obj.owner.username
        return None

    def validate_campaign_id(self, value):
        import re
        if not re.match(r'^[a-z0-9]+(?:-[a-z0-9]+)*$', value):
            raise serializers.ValidationError(
                'campaign_id must be a lowercase slug (letters, digits, hyphens).'
            )
        return value


# ---------------------------------------------------------------------------
# Rate limiting serializers
# ---------------------------------------------------------------------------

from .models import RateLimitRule, RateLimitViolation


class RateLimitRuleSerializer(serializers.ModelSerializer):
    violation_count = serializers.SerializerMethodField()

    class Meta:
        model = RateLimitRule
        fields = (
            'id', 'scope', 'label', 'description',
            'limit', 'window', 'violation_action',
            'violation_threshold', 'is_active',
            'violation_count', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'violation_count', 'created_at', 'updated_at')

    def get_violation_count(self, obj) -> int:
        return obj.violations.filter(is_resolved=False).count()

    def validate_limit(self, value):
        if value < 1:
            raise serializers.ValidationError('Limit must be at least 1.')
        if value > 100_000:
            raise serializers.ValidationError('Limit cannot exceed 100,000.')
        return value

    def validate_scope(self, value):
        import re
        if not re.match(r'^[a-z][a-z0-9_]{1,58}[a-z0-9]$', value):
            raise serializers.ValidationError(
                'Scope must be 3–60 lowercase letters, digits, or underscores.'
            )
        return value

    def save(self, **kwargs):
        """Flush the rule cache after any save."""
        instance = super().save(**kwargs)
        from .throttling import _invalidate_rule_cache
        _invalidate_rule_cache(instance.scope)
        return instance


class RateLimitViolationSerializer(serializers.ModelSerializer):
    rule_scope  = serializers.CharField(source='rule.scope',  read_only=True)
    rule_label  = serializers.CharField(source='rule.label',  read_only=True)
    user_name   = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RateLimitViolation
        fields = (
            'id', 'rule', 'rule_scope', 'rule_label',
            'identifier', 'user', 'user_name',
            'request_count', 'action_taken',
            'request_path', 'request_method', 'user_agent', 'ip_address',
            'is_resolved', 'resolved_by', 'resolved_by_name', 'resolved_at',
            'notes', 'created_at',
        )
        read_only_fields = (
            'id', 'rule_scope', 'rule_label', 'user_name', 'resolved_by_name',
            'identifier', 'user', 'request_count', 'action_taken',
            'request_path', 'request_method', 'user_agent', 'ip_address',
            'created_at',
        )

    def get_user_name(self, obj) -> str:
        if obj.user:
            return obj.user.get_full_name() or obj.user.username
        return ''

    def get_resolved_by_name(self, obj) -> str:
        if obj.resolved_by:
            return obj.resolved_by.get_full_name() or obj.resolved_by.username
        return ''


# ---------------------------------------------------------------------------
# User profile serializer
# ---------------------------------------------------------------------------

class ProfileSerializer(serializers.ModelSerializer):
    """
    Read/write serializer for the authenticated user's own profile.
    Exposes: name fields, username (read-only), email (read-only),
    programme, department, and email_verified status.
    Password changes are handled separately via a dedicated endpoint.
    """
    username         = serializers.CharField(read_only=True)
    email            = serializers.CharField(read_only=True)
    email_verified   = serializers.SerializerMethodField()
    avatar_url       = serializers.SerializerMethodField()
    programme        = serializers.CharField(
        source='profile.programme', allow_blank=True, default='',
        max_length=200,
    )
    department       = serializers.CharField(
        source='profile.department', allow_blank=True, default='',
        max_length=200,
    )

    class Meta:
        model = get_user_model()
        fields = (
            'id', 'username', 'email',
            'first_name', 'last_name',
            'programme', 'department',
            'email_verified', 'avatar_url',
        )
        read_only_fields = ('id', 'username', 'email', 'email_verified', 'avatar_url')

    def get_email_verified(self, obj):
        try:
            return obj.profile.email_verified
        except Exception:
            return False

    def get_avatar_url(self, obj):
        try:
            return obj.profile.avatar_url or ''
        except Exception:
            return ''

    def update(self, instance, validated_data):
        profile_data = validated_data.pop('profile', {})
        # Update User fields
        instance.first_name = validated_data.get('first_name', instance.first_name)
        instance.last_name  = validated_data.get('last_name',  instance.last_name)
        instance.save(update_fields=['first_name', 'last_name'])
        # Update UserProfile fields
        if profile_data:
            from .models import UserProfile
            profile, _ = UserProfile.objects.get_or_create(user=instance)
            for attr, value in profile_data.items():
                setattr(profile, attr, value)
            profile.save()
        return instance


# ---------------------------------------------------------------------------
# Ticket event (audit log) serializer
# ---------------------------------------------------------------------------

class TicketEventSerializer(serializers.ModelSerializer):
    """Read-only serializer for the ticket audit log."""
    actor_name = serializers.SerializerMethodField()
    action_label = serializers.SerializerMethodField()

    class Meta:
        from .models import TicketEvent
        model = TicketEvent
        fields = (
            'id', 'action', 'action_label', 'actor_name',
            'old_value', 'new_value', 'note', 'created_at',
        )
        read_only_fields = fields

    def get_actor_name(self, obj):
        if obj.actor:
            return obj.actor.get_full_name() or obj.actor.username
        return 'System'

    def get_action_label(self, obj):
        labels = {
            'created':          'Ticket created',
            'status_changed':   'Status changed',
            'priority_changed': 'Priority changed',
            'assigned':         'Assigned',
            'stage_changed':    'Stage changed',
            'subject_changed':  'Subject edited',
            'team_changed':     'Team changed',
        }
        return labels.get(obj.action, obj.action)


# ---------------------------------------------------------------------------
# Service status serializers
# ---------------------------------------------------------------------------


class ServiceStatusSerializer(serializers.ModelSerializer):
    """Read-only public serializer — returned by the public status endpoint."""
    category_name = serializers.CharField(source='category.name', read_only=True)
    category_slug = serializers.CharField(source='category.slug', read_only=True)
    category_icon = serializers.CharField(source='category.icon', read_only=True)
    status_label  = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model  = ServiceStatus
        fields = (
            'id', 'category_name', 'category_slug', 'category_icon',
            'status', 'status_label', 'message',
            'incident_started_at', 'estimated_resolution',
            'updated_at',
        )
        read_only_fields = fields


class AdminServiceStatusSerializer(serializers.ModelSerializer):
    """Full read/write serializer for the admin status management panel."""
    category_name = serializers.CharField(source='category.name', read_only=True)
    category_slug = serializers.CharField(source='category.slug', read_only=True)
    category_icon = serializers.CharField(source='category.icon', read_only=True)
    status_label  = serializers.CharField(source='get_status_display', read_only=True)
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model  = ServiceStatus
        fields = (
            'id', 'category', 'category_name', 'category_slug', 'category_icon',
            'status', 'status_label', 'message',
            'incident_started_at', 'estimated_resolution',
            'updated_by_name', 'updated_at',
        )
        read_only_fields = (
            'id', 'category_name', 'category_slug', 'category_icon',
            'status_label', 'updated_by_name', 'updated_at',
        )

    def get_updated_by_name(self, obj) -> str:
        if obj.updated_by:
            return obj.updated_by.get_full_name() or obj.updated_by.username
        return ''


# ---------------------------------------------------------------------------
# Ticket feedback serializers
# ---------------------------------------------------------------------------


class TicketFeedbackSerializer(serializers.ModelSerializer):
    """
    Serializer used for both creating and reading ticket feedback.
    On create the requester and ticket are injected by the view.
    """
    rating_label  = serializers.CharField(source='get_rating_display', read_only=True)
    submitted_by_name = serializers.SerializerMethodField()

    class Meta:
        model  = TicketFeedback
        fields = (
            'id', 'ticket', 'rating', 'rating_label',
            'comment', 'submitted_by_name', 'created_at',
        )
        read_only_fields = (
            'id', 'ticket', 'rating_label',
            'submitted_by_name', 'created_at',
        )

    def validate_rating(self, value: int) -> int:
        if value < 1 or value > 5:
            raise serializers.ValidationError('Rating must be between 1 and 5.')
        return value

    def validate_comment(self, value: str) -> str:
        return value.strip()

    def get_submitted_by_name(self, obj) -> str:
        if obj.submitted_by:
            return obj.submitted_by.get_full_name() or obj.submitted_by.username
        return ''
