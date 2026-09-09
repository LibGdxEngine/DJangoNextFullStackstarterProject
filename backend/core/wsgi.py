import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings.dev')

from core.telemetry import initialize

initialize()

application = get_wsgi_application()
