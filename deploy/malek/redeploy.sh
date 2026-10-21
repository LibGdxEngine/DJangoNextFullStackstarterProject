#!/bin/sh
# Build images from $BASE/src and roll the Imam Malek Academy stack. Root only; one run at a time.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
BASE=${MALEK_BASE:-/srv/malek-academy}
tag=${1:?usage: redeploy.sh <tag>}
test "$(id -u)" = 0 || { echo "root required" >&2; exit 1; }
cd "$BASE"
exec 9>"$BASE/.deploy.lock"
flock -n 9 || { echo "another redeploy is running" >&2; exit 1; }
umask 077
compose() { docker compose --project-name malek-academy --env-file runtime.env -f compose.yml "$@"; }
port=$(sed -n 's/^GATEWAY_PORT=//p' runtime.env); port=${port:-18080}

echo "== building malek-academy-backend:$tag"
docker build -q -t "malek-academy-backend:$tag" -f src/backend/Dockerfile.prod src/backend
echo "== building malek-academy-frontend:$tag"
docker build -q -t "malek-academy-frontend:$tag" --build-arg NEXT_PUBLIC_API_URL=/api -f src/frontend/Dockerfile.prod src/frontend

[ -f images.env ] && cp images.env images.prev.env
printf 'BACKEND_IMAGE=malek-academy-backend:%s\nFRONTEND_IMAGE=malek-academy-frontend:%s\n' "$tag" "$tag" > images.env
set -a; . ./images.env; set +a

echo "== database and cache"
compose up -d --wait --wait-timeout 120 db redis
echo "== backup"
compose exec -T db sh -ec 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/$tag.dump"
echo "== migrate"
compose run --rm --no-deps backend python manage.py migrate --noinput
echo "== ensure academy"
compose run --rm --no-deps backend python manage.py ensure_academy
echo "== roll application services"
compose up -d --wait --wait-timeout 180 --remove-orphans
curl -fsS -H "Host: localhost" "http://127.0.0.1:$port/api/health/ready/"; echo
"$BASE/caddy-ensure.sh" || echo "warning: caddy-ensure failed; the timer will retry" >&2

# Keep only the current and previous image pair.
keep=$(cat images.env images.prev.env 2>/dev/null | cut -d= -f2-)
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^malek-academy-(backend|frontend):' | while read -r image; do
    echo "$keep" | grep -qxF "$image" || docker rmi "$image" >/dev/null 2>&1 || true
done
echo "deployed $tag"
