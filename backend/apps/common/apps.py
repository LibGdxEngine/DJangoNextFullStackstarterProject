from django.apps import AppConfig

class CommonConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.common'
    label = 'common'
    verbose_name = 'Common Platform Utilities'

    def ready(self):
        from django.conf import settings
        from django.core.exceptions import ImproperlyConfigured
        from . import checks

        # Gunicorn/Celery do not run manage.py check before accepting work.
        if settings.RATE_LIMIT_PRODUCTION:
            errors = checks.check_rate_limit_configuration(None)
            if errors:
                raise ImproperlyConfigured('; '.join(error.msg for error in errors))
