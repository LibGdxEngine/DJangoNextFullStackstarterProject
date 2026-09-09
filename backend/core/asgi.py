import os
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings.dev')

from core.telemetry import initialize

initialize()

application = get_asgi_application()
