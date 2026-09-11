import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


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

        User = get_user_model()
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
        action = 'Created' if created else 'Updated'
        self.stdout.write(self.style.SUCCESS(f'{action} superuser {user.username} ({user.email}).'))
