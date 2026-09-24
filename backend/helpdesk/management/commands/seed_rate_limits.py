"""
Management command: seed_rate_limits
Usage: python manage.py seed_rate_limits
Creates default RateLimitRule rows without overwriting existing ones.
"""
from django.core.management.base import BaseCommand
from helpdesk.throttling import seed_default_rules


class Command(BaseCommand):
    help = 'Seed default rate-limit rules into the database (idempotent).'

    def handle(self, *args, **options):
        seed_default_rules()
        self.stdout.write(self.style.SUCCESS('Default rate-limit rules seeded.'))
