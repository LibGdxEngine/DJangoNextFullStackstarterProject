#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

if [ "$DB_HOST" ]
then
    echo "Waiting for database at $DB_HOST:$DB_PORT..."
    # A simple Python command to check if database port is open
    python -c "
import socket
import time
import sys

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(2)
while True:
    try:
        s.connect(('$DB_HOST', int('$DB_PORT')))
        s.close()
        break
    except (socket.timeout, ConnectionRefusedError):
        time.sleep(0.5)
"
    echo "Database is ready!"
fi

# Apply database migrations
if [ "$1" != "celery" ]
then
    echo "Applying database migrations..."
    python manage.py migrate --noinput
fi

# Collect static files for production
if [ "$DJANGO_SETTINGS_MODULE" = "core.settings.prod" ] && [ "$1" != "celery" ]
then
    echo "Collecting static files..."
    python manage.py collectstatic --noinput
fi

# Beat's DatabaseScheduler reads django_celery_beat tables, but the backend
# container owns migrations, so wait for it rather than racing it.
case " $* " in
    *" beat "*)
        echo "Waiting for migrations to be applied..."
        until python manage.py migrate --check >/dev/null 2>&1
        do
            sleep 2
        done
        echo "Migrations are applied!"
        ;;
esac

exec "$@"
