import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = 'Create or update the initial IIC administrator from explicit credentials.'

    def add_arguments(self, parser):
        parser.add_argument('--username', default='aayush.limbu')
        parser.add_argument('--email', default='aayush.limbu@iic.edu.np')
        parser.add_argument('--first-name', default='Aayush')
        parser.add_argument('--last-name', default='Wanem Limbu')
        parser.add_argument('--password', default=None)

    def handle(self, *args, **options):
        password = options['password'] or os.environ.get('INITIAL_ADMIN_PASSWORD')
        if not password:
            raise CommandError('Provide --password or set INITIAL_ADMIN_PASSWORD.')

        from helpdesk.models import RoleGrant, RoleAuditEvent
        from django.conf import settings as django_settings

        User = get_user_model()

        with transaction.atomic():
            user, created = User.objects.get_or_create(
                email__iexact=options['email'],
                defaults={'username': options['username'], 'email': options['email']},
            )
            if User.objects.exclude(pk=user.pk).filter(username__iexact=options['username']).exists():
                raise CommandError('The requested username belongs to another account.')

            user.username = options['username']
            user.email = options['email'].lower()
            user.first_name = options['first_name']
            user.last_name = options['last_name']
            user.is_staff = True
            user.is_superuser = True
            user.is_active = True
            user.set_password(password)
            user.save()

            # Ensure the user also has the application-level 'administrator' role grant.
            grant, grant_created = RoleGrant.objects.get_or_create(
                user=user,
                role='administrator',
                expires_at__isnull=True,
                defaults={'granted_by': None},
            )

            if grant_created:
                RoleAuditEvent.objects.create(
                    actor=None,
                    target=user,
                    role='administrator',
                    action=RoleAuditEvent.ACTION_GRANTED,
                )

        # ── Send welcome email ────────────────────────────────────────────────
        # Only send on account creation (not on password update re-runs).
        if created and user.email:
            self._send_welcome_email(user, password, django_settings)

        action = 'Created' if created else 'Updated'
        role_action = 'granted' if grant_created else 'already held'
        self.stdout.write(self.style.SUCCESS(
            f'{action} superuser {user.username} ({user.email}). '
            f'Application role: administrator ({role_action}).'
        ))

    def _send_welcome_email(self, user, password: str, django_settings) -> None:
        """
        Send a branded HTML welcome email containing the admin's credentials,
        the frontend URL, and the admin panel URL.

        If a real SMTP / Mailgun transport is configured, send immediately.
        Otherwise, write to NotificationOutbox so Celery can deliver it later
        once an admin configures a mail channel.
        """
        from helpdesk.email_config_service import is_real_smtp_configured
        from helpdesk.models import NotificationOutbox

        helpdesk_url = getattr(django_settings, 'HELPDESK_URL', 'http://localhost:3000')
        admin_url    = f'{helpdesk_url}/admin'

        context = {
            'first_name':   user.first_name or user.username,
            'username':     user.username,
            'password':     password,
            'helpdesk_url': helpdesk_url,
            'admin_url':    admin_url,
            'support_email': getattr(django_settings, 'VERIFICATION_FROM_EMAIL',
                                     'noreply@iic.edu.np'),
        }

        subject = f'Welcome to IIC IT Helpdesk — Your Administrator Account'
        event_type = 'bootstrap_admin_welcome'

        if is_real_smtp_configured():
            # Real SMTP/Mailgun available — send immediately
            try:
                from helpdesk.email_dispatch import resolve_and_send
                resolve_and_send(
                    event_type=event_type,
                    context=context,
                    to_email=user.email,
                    subject=subject,
                    log_tag=f'bootstrap_admin user_id={user.pk}',
                )
                self.stdout.write(
                    self.style.SUCCESS(f'Welcome email sent to {user.email}.')
                )
            except Exception as exc:
                self.stderr.write(
                    self.style.WARNING(f'Welcome email failed to send: {exc}')
                )
        else:
            # No real transport configured — queue in outbox for later delivery.
            # The deliver_notification_outbox Celery task will retry every 2 min
            # once an admin configures SMTP via Admin → Notifications.
            try:
                # Store password in context only for this specific outbox item.
                # The outbox serialises context_json but it stays in the DB,
                # not exposed in any API response.
                NotificationOutbox.objects.create(
                    event_type=event_type,
                    recipient_email=user.email,
                    subject=subject,
                    context_json=context,
                    max_attempts=10,   # keep retrying until SMTP is configured
                )
                self.stdout.write(self.style.WARNING(
                    f'No SMTP configured — welcome email queued for {user.email}. '
                    'It will be sent automatically once email is set up in '
                    'Admin → Notifications → Channels.'
                ))
            except Exception as exc:
                self.stderr.write(
                    self.style.WARNING(f'Could not queue welcome email: {exc}')
                )
