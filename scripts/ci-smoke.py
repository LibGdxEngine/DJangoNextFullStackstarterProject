#!/usr/bin/env python3
"""Verify production routing, login/session, static assets and background jobs."""
import http.cookiejar
import json
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

base = sys.argv[1].rstrip('/')
compose = ['docker', 'compose', '--env-file', 'deploy/runtime.env', '-f', 'deploy/compose.yml']
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def request(path, data=None, headers=None, expected=200):
    req = urllib.request.Request(base + path, data=data, headers=headers or {})
    try:
        response = client.open(req, timeout=15)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        body = response.read()
        assert response.status == expected, f'{path}: expected {expected}, got {response.status}'
        return body


def django(code):
    subprocess.run(compose + ['exec', '-T', 'backend', 'python', 'manage.py', 'shell', '-c', code], check=True, timeout=120)


request('/healthz')
request('/api/health/live/')
request('/api/health/ready/')
request('/static/admin/css/base.css')
html = request('/').decode()
assets = re.findall(r'(?:src|href)="([^" ]+/_next/static/[^" ]+|/_next/static/[^" ]+)"', html)
assert assets, 'frontend did not expose Next static assets'
request(assets[0].replace('&amp;', '&'))
request('/api/v1/auth/me/', expected=401)

email = 'ci-smoke@example.invalid'
password = secrets.token_urlsafe(24)
fixture = (
    'from django.contrib.auth import get_user_model; '
    'from django.utils import timezone; '
    f'user = get_user_model().objects.create_user(email={email!r}, phone="+12025550123", password={password!r}, status="active", phone_verified_at=timezone.now())'
)
django(fixture)
try:
    tokens = json.loads(request('/api/v1/auth/login/', json.dumps({'identifier': email, 'password': password}).encode(), {'Content-Type': 'application/json'}))
    assert tokens.get('access') and tokens.get('refresh'), 'login did not issue tokens'
    request('/api/v1/auth/me/', headers={'Authorization': 'Bearer ' + tokens['access']})
    csrf = json.loads(request('/api/auth/csrf'))['csrfToken']
    form = urllib.parse.urlencode({'csrfToken': csrf, 'identifier': email, 'password': password, 'json': 'true', 'callbackUrl': base + '/'}).encode()
    request('/api/auth/callback/credentials', form, {'Content-Type': 'application/x-www-form-urlencoded'})
    session = json.loads(request('/api/auth/session'))
    assert session.get('user'), 'NextAuth did not establish a logged-in session'
    django('from apps.common.tasks.health import ping; assert ping.delay().get(timeout=30) == "pong"')
    # The scheduler must generate a fresh heartbeat; do not enqueue it ourselves.
    django('from django.core.cache import cache; from apps.common.tasks.health import BEAT_HEARTBEAT_CACHE_KEY; cache.delete(BEAT_HEARTBEAT_CACHE_KEY)')
    deadline = time.monotonic() + 100
    while True:
        result = subprocess.run(compose + ['exec', '-T', 'backend', 'python', 'manage.py', 'shell', '-c', 'from django.core.cache import cache; from apps.common.tasks.health import BEAT_HEARTBEAT_CACHE_KEY; assert cache.get(BEAT_HEARTBEAT_CACHE_KEY)'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        if result.returncode == 0:
            break
        if time.monotonic() >= deadline:
            raise AssertionError('Celery Beat did not produce a fresh heartbeat')
        time.sleep(5)
finally:
    django(f'from django.contrib.auth import get_user_model; get_user_model().objects.filter(email={email!r}).delete()')
print('Production image smoke passed: health, static assets, API auth, NextAuth session, worker and beat.')
