#!/bin/sh
set -e

# Defaults preserve local development; deployment runs migrations explicitly.
RUN_MIGRATIONS=${RUN_MIGRATIONS:-true}
RUN_COLLECTSTATIC=${RUN_COLLECTSTATIC:-true}

if [ -n "${DB_HOST:-}" ]; then
    echo "Waiting for database..."
    python - <<'PY'
import os
import socket
import time

host = os.environ['DB_HOST']
port = int(os.environ.get('DB_PORT', '5432'))
timeout = float(os.environ.get('DB_WAIT_TIMEOUT', '60'))
deadline = time.monotonic() + timeout
while True:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SystemExit('Database readiness timed out')
    try:
        with socket.create_connection((host, port), timeout=min(2, remaining)):
            break
    except OSError:
        time.sleep(min(0.5, max(0, deadline - time.monotonic())))
PY
fi

if [ "$RUN_MIGRATIONS" = "true" ] && [ "${1:-}" != "celery" ]; then
    echo "Applying database migrations..."
    python manage.py migrate --noinput
fi

if [ "$RUN_COLLECTSTATIC" = "true" ] && [ "${DJANGO_SETTINGS_MODULE:-}" = "core.settings.prod" ] && [ "${1:-}" != "celery" ]; then
    echo "Collecting static files..."
    python manage.py collectstatic --noinput
fi

# Beat's DatabaseScheduler requires the schema created by the migration job.
if [ "${1:-}" = "celery" ]; then
    case " $* " in
        *" beat "*)
            echo "Waiting for migrations to be applied..."
            python - <<'PY'
import os
import subprocess
import sys
import time

deadline = time.monotonic() + float(os.environ.get('MIGRATION_WAIT_TIMEOUT', '120'))
while True:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SystemExit('Migration readiness timed out')
    try:
        result = subprocess.run(
            [sys.executable, 'manage.py', 'migrate', '--check'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=min(10, remaining),
            check=False,
        )
        if result.returncode == 0:
            break
    except subprocess.TimeoutExpired:
        pass
    time.sleep(min(2, max(0, deadline - time.monotonic())))
PY
            ;;
    esac
fi

exec "$@"
