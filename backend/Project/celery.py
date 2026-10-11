"""
Celery application instance for the IIC IT Helpdesk project.

Usage
-----
Development (single worker + beat in one process — convenient, not for production):
    celery -A Project worker --beat --loglevel=info

Production (run worker and beat as separate systemd services):
    celery -A Project worker --loglevel=info
    celery -A Project beat   --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler

The broker and result backend are both Redis, configured via the REDIS_URL
environment variable (default: redis://127.0.0.1:6379/0).
"""

import os

from celery import Celery

# Tell Celery which Django settings module to use.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Project.settings')

app = Celery('Project')

# Read configuration from Django settings using the CELERY_ namespace prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in any installed app's tasks.py module.
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Utility task — prints the request repr. Useful for verifying worker connectivity."""
    print(f'Request: {self.request!r}')
