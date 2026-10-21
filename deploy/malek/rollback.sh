#!/bin/sh
# Restart the application services on the previous image pair. Does not touch the database.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
BASE=${MALEK_BASE:-/srv/malek-academy}
test "$(id -u)" = 0 || { echo "root required" >&2; exit 1; }
cd "$BASE"
test -f images.prev.env || { echo "no previous release" >&2; exit 1; }
exec 9>"$BASE/.deploy.lock"
flock -n 9 || { echo "another redeploy is running" >&2; exit 1; }
cp images.env images.failed.env
cp images.prev.env images.env
set -a; . ./images.env; set +a
docker compose --project-name malek-academy --env-file runtime.env -f compose.yml \
    up -d --wait --wait-timeout 180 backend frontend celery_worker celery_beat gateway
echo "rolled back to: $BACKEND_IMAGE / $FRONTEND_IMAGE"
