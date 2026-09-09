"""Unit/regression settings; strict limiter tests explicitly enable real Redis."""
from .dev import *

RATE_LIMIT_MODE = 'off'
RATE_LIMIT_BASELINE_MODE = 'off'
RATE_LIMIT_TRUST_PROXY = False
RATE_LIMIT_ALLOW_DIRECT = True
RATE_LIMIT_PRODUCTION = False
RATE_LIMIT_KEY_SECRET = 'test-rate-limit-key-not-for-production'
RATE_LIMIT_KEY_PREFIX = 'mobser:rl:test'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
if os.environ.get('TEST_DB_NAME'):
    DATABASES['default']['TEST'] = {'NAME': os.environ['TEST_DB_NAME']}
