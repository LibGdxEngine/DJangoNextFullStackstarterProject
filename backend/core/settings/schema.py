"""Deterministic, service-independent settings used only to export OpenAPI."""
from .base import *

SECRET_KEY = 'schema-generation-only-not-for-serving-requests'
DEBUG = False
RATE_LIMIT_MODE = 'off'
RATE_LIMIT_BASELINE_MODE = 'off'
RATE_LIMIT_PRODUCTION = False
ALLOWED_HOSTS = ['localhost']
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
SOCIAL_AUTH_PROVIDERS = {'google': {'client_id': ''}}
