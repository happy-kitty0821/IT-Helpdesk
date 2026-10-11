# This makes `celery` importable as `from Project.celery import app` and
# ensures the Celery app is loaded whenever Django starts so that shared_task
# decorators in helpdesk/tasks.py can reference it.
from .celery import app as celery_app  # noqa: F401

__all__ = ('celery_app',)
