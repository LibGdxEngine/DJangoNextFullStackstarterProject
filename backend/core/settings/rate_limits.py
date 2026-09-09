"""Named rate policies; counts and rolling windows are deployment-tunable."""
import json
import os

RATE_LIMIT_MODE = os.environ.get('RATE_LIMIT_MODE', 'enforce')
RATE_LIMIT_BASELINE_MODE = os.environ.get('RATE_LIMIT_BASELINE_MODE', 'enforce')
RATE_LIMIT_PRODUCTION = False
RATE_LIMIT_TRUST_PROXY = os.environ.get('RATE_LIMIT_TRUST_PROXY', 'true').lower() == 'true'
RATE_LIMIT_ALLOW_DIRECT = os.environ.get('RATE_LIMIT_ALLOW_DIRECT', 'false').lower() == 'true'
RATE_LIMIT_PROXY_TOKEN = os.environ.get('RATE_LIMIT_PROXY_TOKEN', '')
RATE_LIMIT_KEY_SECRET = os.environ.get('RATE_LIMIT_KEY_SECRET', '')
RATE_LIMIT_KEY_PREFIX = 'mobser:rl:v1:'
RATE_LIMIT_REDIS_URL = os.environ.get('RATE_LIMIT_REDIS_URL') or os.environ.get('CACHE_URL') or 'redis://redis:6379/1'
RATE_LIMIT_REDIS_TIMEOUT = float(os.environ.get('RATE_LIMIT_REDIS_TIMEOUT', '0.3'))
RATE_LIMIT_CACHE_ALIAS = 'default'
RATE_LIMIT_BASELINE_RATES = {
    'anonymous': os.environ.get('RATE_LIMIT_ANONYMOUS', '60/min'),
    'user': os.environ.get('RATE_LIMIT_USER', '300/min'),
    'status': os.environ.get('RATE_LIMIT_STATUS', '30/min'),
}
RATE_LIMITS = {
    'login_ip': [(20, 60)], 'login_identifier': [(10, 900)],
    'signup_ip': [(5, 3600)],
    'forgot_ip': [(10, 3600)], 'forgot_identifier': [(3, 3600), (10, 86400)],
    'resend_ip': [(10, 3600)],
    'confirm_ip': [(20, 60)], 'confirm_user': [(20, 60)],
    'reset_ip': [(20, 60)], 'reset_subject': [(5, 900)],
    'refresh_ip': [(60, 60)], 'refresh_subject': [(30, 60)],
    'verify_ip': [(60, 60)],
    'social_ip': [(20, 60)], 'social_subject': [(10, 900)],
    'logout_ip': [(60, 60)], 'profile_update_user': [(30, 60)],
    'sensitive_ip': [(20, 60)], 'sensitive_user': [(5, 900)],
    'send_recipient': [(1, 60), (5, 3600), (10, 86400)],
    'expensive_user': [(5, 60)],
    'webhook_ingress': [(600, 60)], 'webhook_connection': [(600, 60)],
}
RATE_LIMITS.update(json.loads(os.environ.get('RATE_LIMIT_POLICIES') or '{}'))
