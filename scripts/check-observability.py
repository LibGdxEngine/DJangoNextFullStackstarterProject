#!/usr/bin/env python3
"""Exercise the development Caddy boundary using temporary Django users/sessions.

Run after `docker compose up -d --build`. This checks the actual proxy, not just
the authorization view. Temporary fixtures are deleted even when a check fails.
"""

import argparse
import http.cookiejar
import json
import re
import secrets
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def django(code):
    source = "import os\nos.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings.dev')\nimport django\ndjango.setup()\n" + code
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "backend", "python", "-"],
        input=source, text=True, capture_output=True, check=True,
    )
    for line in result.stdout.splitlines():
        if line.startswith("OBSERVABILITY_CHECK="):
            return json.loads(line.split("=", 1)[1])
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    prefix = "obscheck-" + uuid.uuid4().hex
    password = secrets.token_urlsafe(32)
    fixtures = {}
    checks = 0
    opener = urllib.request.build_opener(NoRedirect())

    def request(path, cookie=None, headers=None):
        merged = dict(headers or {})
        if cookie:
            merged["Cookie"] = "sessionid=" + cookie
        req = urllib.request.Request(base + path, headers=merged)
        try:
            response = opener.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        return response.code, response.headers, response.read()

    def expect(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(message)
        checks += 1
        print("PASS:", message)

    try:
        fixtures = django(f'''
import json
from django.contrib.auth import get_user_model
from django.test import Client
User = get_user_model()
fixtures = {{}}
for role, staff, active, status in [
    ('staff', True, True, 'active'),
    ('user', False, True, 'active'),
    ('blocked', True, True, 'blocked'),
    ('inactive', True, False, 'active'),
]:
    user = User(email={prefix!r} + '-' + role + '@observability.invalid', phone=None,
                is_staff=staff, is_active=active, status=status)
    user.set_password({password!r})
    user.save()
    client = Client()
    client.force_login(user, backend='django.contrib.auth.backends.ModelBackend')
    fixtures[role] = {{'id': str(user.pk), 'email': user.email,
                      'session': client.cookies['sessionid'].value}}
print('OBSERVABILITY_CHECK=' + json.dumps(fixtures))
''')
        for path in ("/observability/", "/observability/api/user", "/observability/public/build/does-not-exist.js", "/observability/api/live/ws"):
            code, headers, _ = request(path, headers={"X-WEBAUTH-USER": fixtures["staff"]["id"], "X-WEBAUTH-ROLE": "Admin"})
            expect(code == 302 and headers.get("Location") == "/admin/login/?next=/observability/",
                   f"anonymous/forged identity denied at {path}")
        for role in ("user", "blocked", "inactive"):
            code, _, _ = request("/observability/api/user", fixtures[role]["session"])
            expect(code in (302, 403), f"{role} cannot access Grafana")
        code, _, body = request("/observability/api/user", fixtures["staff"]["session"], {"X-WEBAUTH-USER": "admin", "Authorization": "Bearer forged"})
        expect(code == 200, "active staff can access Grafana through Caddy")
        identity = json.loads(body)
        expect(identity.get("login") == fixtures["staff"]["id"] and not identity.get("isGrafanaAdmin"),
               "verified UUID replaces forged identity without Grafana administrator rights")
        code, _, body = request("/observability/api/user/orgs", fixtures["staff"]["session"])
        expect(code == 200 and all(org["role"] == "Viewer" for org in json.loads(body)),
               "staff receive Viewer access")
        code, _, _ = request("/observability/api/user", "expired-observability-session")
        expect(code == 302, "expired session cannot access Grafana")

        # Exercise the real Django admin login and its return into Grafana.
        jar = http.cookiejar.CookieJar()
        login_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())
        login_url = base + "/admin/login/?next=/observability/"
        login_html = login_opener.open(login_url, timeout=15).read().decode()
        csrf = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', login_html).group(1)
        payload = urllib.parse.urlencode({"username": fixtures["staff"]["email"], "password": password,
                                          "csrfmiddlewaretoken": csrf, "next": "/observability/"}).encode()
        try:
            login_response = login_opener.open(urllib.request.Request(login_url, data=payload, headers={"Referer": login_url}), timeout=15)
        except urllib.error.HTTPError as error:
            login_response = error
        expect(login_response.code == 302 and login_response.headers.get("Location") == "/observability/",
               "Django admin login returns to observability")
        logged_in_session = next(cookie.value for cookie in jar if cookie.name == "sessionid")
        fixtures["login"] = {"session": logged_in_session}
        code, _, _ = request("/observability/api/user", logged_in_session)
        expect(code == 200, "real admin login establishes Grafana access")

        django(f"from django.contrib.auth import get_user_model\nget_user_model().objects.filter(pk={fixtures['staff']['id']!r}).update(is_staff=False)\n")
        code, _, _ = request("/observability/api/user", fixtures["staff"]["session"])
        expect(code == 403, "staff revocation blocks the next request")
        for path in ("/api/health/live/", "/api/health/ready/", "/api/hello/"):
            code, _, _ = request(path)
            expect(code == 200, f"healthy existing routing at {path}")
        code, _, _ = request("/internal/observability/auth/")
        expect(code == 404, "internal authorization endpoint is not publicly routed")
        print(f"Completed {checks} proxy/authentication checks.")
    finally:
        sessions = [fixture["session"] for fixture in fixtures.values()]
        django(f'''
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
Session.objects.filter(session_key__in={sessions!r}).delete()
get_user_model().objects.filter(email__startswith={prefix!r}).delete()
''')


if __name__ == "__main__":
    main()
