import os
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third party apps
    'rest_framework',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'drf_spectacular',
    'django_celery_beat',
    
    # Platform apps
    'apps.common.apps.CommonConfig',
    'apps.accounts.apps.AccountsConfig',
    'apps.messaging.apps.MessagingConfig',
    'apps.integrations.apps.IntegrationsConfig',
    'apps.organizations.apps.OrganizationsConfig',
    'apps.billing.apps.BillingConfig',
    'apps.notifications.apps.NotificationsConfig',
    'apps.audit.apps.AuditConfig',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',  # Needs to be at the top
    'django.middleware.security.SecurityMiddleware',
    'core.middleware.request_id.RequestIdMiddleware',  # Trace requests with X-Request-ID
    'whitenoise.middleware.WhiteNoiseMiddleware',  # WhiteNoise static serving
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]


ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'
ASGI_APPLICATION = 'core.asgi.application'

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Authentication Backends
AUTHENTICATION_BACKENDS = [
    'apps.accounts.backends.EmailOrPhoneBackend',
    'django.contrib.auth.backends.ModelBackend',
]

SILENCED_SYSTEM_CHECKS = ['auth.W004']

# Custom User Model
AUTH_USER_MODEL = 'accounts.User'

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# DRF settings
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'apps.accounts.authentication.VersionedJWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
        'rest_framework.authentication.BasicAuthentication',
    ],
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

# OpenAPI / Swagger configuration
SPECTACULAR_SETTINGS = {
    'TITLE': 'Dockerized Full-Stack Template API',
    'DESCRIPTION': 'API documentation for our Next.js + Django starter project.',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
}

# SimpleJWT configuration
from datetime import timedelta
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': os.environ.get('SECRET_KEY', 'django-insecure-dev-secret-key-template-project-1234'),
    'AUTH_HEADER_TYPES': ('Bearer',),
    'TOKEN_OBTAIN_SERIALIZER': 'apps.accounts.api.serializers.auth.CustomTokenObtainPairSerializer',
}

# ------------------------------------------------------------------------------
# Messaging & WhatsApp Integration Settings (HireAgents)
# ------------------------------------------------------------------------------
OTP_SECRET = os.environ.get('OTP_SECRET', 'dev-otp-secret-key-32-chars-minimum-mobser')
WHATSAPP_AUTH_TEMPLATE = os.environ.get('WHATSAPP_AUTH_TEMPLATE', 'auth_verification_otp')
HIREAGENTS_BASE_URL = os.environ.get('HIREAGENTS_BASE_URL', 'https://hireagents.blinksolutions.tech')

HIREAGENTS_CONNECTIONS = {
    'auth': {
        'channel_id': os.environ.get('HIREAGENTS_AUTH_CHANNEL_ID', ''),
        'api_key': os.environ.get('HIREAGENTS_AUTH_API_KEY', ''),
        'webhook_api_key': os.environ.get('HIREAGENTS_AUTH_WEBHOOK_API_KEY', 'dev-hireagents-auth-webhook-key'),
        'webhook_signing_secret': os.environ.get('HIREAGENTS_AUTH_WEBHOOK_SIGNING_SECRET', ''),
    },
    'support': {
        'channel_id': os.environ.get('HIREAGENTS_SUPPORT_CHANNEL_ID', ''),
        'api_key': os.environ.get('HIREAGENTS_SUPPORT_API_KEY', ''),
        'webhook_api_key': os.environ.get('HIREAGENTS_SUPPORT_WEBHOOK_API_KEY', 'dev-hireagents-support-webhook-key'),
        'webhook_signing_secret': os.environ.get('HIREAGENTS_SUPPORT_WEBHOOK_SIGNING_SECRET', ''),
    },
}

# ------------------------------------------------------------------------------
# Social Sign-In Providers
# ------------------------------------------------------------------------------
# A provider is enabled only when its client_id is set, so dropping the credentials
# into the environment is all that is needed to turn the flow on.
SOCIAL_AUTH_PROVIDERS = {
    'google': {
        'client_id': os.environ.get('GOOGLE_CLIENT_ID', ''),
    },
}

# Celery configurations
from celery.schedules import crontab

REDIS_URL = os.environ.get('REDIS_URL', 'redis://redis:6379/0')

CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', REDIS_URL)
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', REDIS_URL)
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE
CELERY_RESULT_EXPIRES = 3600
CELERY_RESULT_EXTENDED = True
CELERY_TASK_TRACK_STARTED = True

# Redeliver a task if the worker dies mid-execution rather than losing it.
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1

# The soft limit raises SoftTimeLimitExceeded inside the task so it can unwind; the hard
# limit kills the worker child process.
CELERY_TASK_SOFT_TIME_LIMIT = int(os.environ.get('CELERY_TASK_SOFT_TIME_LIMIT', 240))
CELERY_TASK_TIME_LIMIT = int(os.environ.get('CELERY_TASK_TIME_LIMIT', 300))

# Redis has no broker-side ack: it redelivers anything unacknowledged after visibility_timeout,
# so this must stay above the hard time limit plus the longest retry countdown.
CELERY_BROKER_TRANSPORT_OPTIONS = {
    'visibility_timeout': int(os.environ.get('CELERY_VISIBILITY_TIMEOUT', 3600)),
    'max_retries': 3,
}
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_TASK_DEFAULT_RETRY_DELAY = 5

CELERY_WORKER_MAX_TASKS_PER_CHILD = 200
CELERY_WORKER_MAX_MEMORY_PER_CHILD = 250_000  # KB
CELERY_WORKER_SEND_TASK_EVENTS = True
CELERY_WORKER_HIJACK_ROOT_LOGGER = False

CELERY_TASK_DEFAULT_QUEUE = 'celery'

# Maintenance sweeps are isolated onto their own queue so a long-running cleanup
# never delays latency-sensitive work such as OTP delivery.
CELERY_TASK_ROUTES = {
    'apps.accounts.tasks.*': {'queue': 'maintenance'},
    'apps.billing.tasks.*': {'queue': 'maintenance'},
    'apps.organizations.tasks.*': {'queue': 'maintenance'},
    'apps.common.tasks.cleanup_expired_sessions': {'queue': 'maintenance'},
    'apps.common.tasks.cleanup_temp_uploads': {'queue': 'maintenance'},
    'apps.common.tasks.cleanup_task_records': {'queue': 'maintenance'},
    'apps.notifications.tasks.send_scheduled_reports': {'queue': 'maintenance'},
}

# Defaults for the shared task base class in apps.common.tasks.
TASK_MAX_RETRIES = int(os.environ.get('TASK_MAX_RETRIES', 5))
TASK_RETRY_BACKOFF = int(os.environ.get('TASK_RETRY_BACKOFF', 5))
TASK_RETRY_BACKOFF_MAX = int(os.environ.get('TASK_RETRY_BACKOFF_MAX', 600))
# How long a successful idempotency record suppresses a repeat execution.
TASK_IDEMPOTENCY_TTL = int(os.environ.get('TASK_IDEMPOTENCY_TTL', 60 * 60 * 24 * 7))
# Must outlive the hard time limit so a crashed worker's lock is not held forever.
TASK_LOCK_TIMEOUT = int(os.environ.get('TASK_LOCK_TIMEOUT', 900))
TASK_RECORD_RETENTION_DAYS = int(os.environ.get('TASK_RECORD_RETENTION_DAYS', 30))

# DatabaseScheduler syncs these defaults into the django_celery_beat tables on
# startup, after which they can be retimed from the Django admin without a deploy.
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'
CELERY_BEAT_SCHEDULE = {
    'beat-heartbeat': {
        'task': 'apps.common.tasks.beat_heartbeat',
        'schedule': 60.0,
    },
    'purge-expired-jwt-tokens': {
        'task': 'apps.accounts.tasks.purge_expired_jwt_tokens',
        'schedule': crontab(hour='3', minute='0'),
    },
    'purge-expired-verification-challenges': {
        'task': 'apps.accounts.tasks.purge_expired_verification_challenges',
        'schedule': crontab(hour='3', minute='15'),
    },
    'cleanup-expired-sessions': {
        'task': 'apps.common.tasks.cleanup_expired_sessions',
        'schedule': crontab(hour='3', minute='30'),
    },
    'cleanup-temp-uploads': {
        'task': 'apps.common.tasks.cleanup_temp_uploads',
        'schedule': crontab(hour='3', minute='45'),
    },
    'cleanup-task-records': {
        'task': 'apps.common.tasks.cleanup_task_records',
        'schedule': crontab(hour='4', minute='0'),
    },
    'expire-pending-invitations': {
        'task': 'apps.organizations.tasks.expire_pending_invitations',
        'schedule': crontab(minute='0'),
    },
    'sync-subscriptions': {
        'task': 'apps.billing.tasks.sync_subscriptions',
        'schedule': crontab(hour='*/6', minute='10'),
    },
    'send-scheduled-reports': {
        'task': 'apps.notifications.tasks.send_scheduled_reports',
        'schedule': crontab(day_of_week='1', hour='7', minute='0'),
    },
}

# ------------------------------------------------------------------------------
# Scheduled Job Retention Windows
# ------------------------------------------------------------------------------
VERIFICATION_CHALLENGE_RETENTION_DAYS = int(os.environ.get('VERIFICATION_CHALLENGE_RETENTION_DAYS', 1))
EXPIRED_TOKEN_RETENTION_DAYS = int(os.environ.get('EXPIRED_TOKEN_RETENTION_DAYS', 1))
INVITATION_EXPIRY_DAYS = int(os.environ.get('INVITATION_EXPIRY_DAYS', 7))
TEMP_UPLOAD_RETENTION_HOURS = int(os.environ.get('TEMP_UPLOAD_RETENTION_HOURS', 24))
SUBSCRIPTION_PAST_DUE_GRACE_HOURS = int(os.environ.get('SUBSCRIPTION_PAST_DUE_GRACE_HOURS', 24))
SCHEDULED_REPORT_PERIOD_DAYS = int(os.environ.get('SCHEDULED_REPORT_PERIOD_DAYS', 7))

# ------------------------------------------------------------------------------
# Cache (also backs the distributed locks that keep tasks idempotent)
# ------------------------------------------------------------------------------
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': os.environ.get('CACHE_URL', 'redis://redis:6379/1'),
        'KEY_PREFIX': 'mobser',
    }
}

# ------------------------------------------------------------------------------
# Email
# ------------------------------------------------------------------------------
EMAIL_BACKEND = os.environ.get('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'no-reply@mobser.local')

# ------------------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------------------
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        # Adds task_name/task_id to records emitted from inside a Celery task.
        'task_aware': {
            '()': 'celery.app.log.TaskFormatter',
            'fmt': '[%(asctime)s] %(levelname)s %(name)s %(task_name)s[%(task_id)s] %(message)s',
            'use_color': False,
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'task_aware',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': LOG_LEVEL,
    },
    'loggers': {
        'django.db.backends': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
        'celery': {
            'handlers': ['console'],
            'level': LOG_LEVEL,
            'propagate': False,
        },
        'apps': {
            'handlers': ['console'],
            'level': LOG_LEVEL,
            'propagate': False,
        },
    },
}
