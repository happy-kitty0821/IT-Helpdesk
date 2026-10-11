from django.apps import AppConfig


class HelpdeskConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'helpdesk'

    def ready(self):
        import helpdesk.signals  # noqa: F401 — registers signal receivers
        # Apply any active DB EmailConfiguration override to settings.MAILERS
        # so the correct transport is used immediately after every server restart,
        # not only after an admin next saves the EmailConfiguration row.
        try:
            from helpdesk.email_config_service import apply_mailers_override
            apply_mailers_override()
        except Exception:
            pass  # DB may not be ready yet (first migration run, etc.)
