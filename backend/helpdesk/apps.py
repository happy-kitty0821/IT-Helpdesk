from django.apps import AppConfig


class HelpdeskConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'helpdesk'

    def ready(self):
        import helpdesk.signals  # noqa: F401 — registers signal receivers
        # Note: apply_mailers_override() is intentionally NOT called here.
        # DB queries during ready() can corrupt forked worker connections in
        # Gunicorn's prefork model. The DB EmailConfiguration override is
        # applied lazily on first use inside email_config_service, and is
        # also applied via the post_save signal on EmailConfiguration saves.
