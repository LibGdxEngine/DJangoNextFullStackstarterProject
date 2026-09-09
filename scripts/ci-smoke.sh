#!/usr/bin/env bash
# Runs only against disposable CI infrastructure and published image digests.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BACKEND_IMAGE:?required}"
: "${FRONTEND_IMAGE:?required}"
export COMPOSE_PROJECT_NAME="mobser-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
export EDGE_NETWORK="${COMPOSE_PROJECT_NAME}-edge"
export EDGE_ALIAS="${COMPOSE_PROJECT_NAME}-gateway"
export GATEWAY_PORT=18080
export DB_NAME=mobser_ci DB_USER=mobser_ci DB_PASSWORD=ci-disposable-database-password
if [[ -e deploy/runtime.env ]]; then
    echo 'Refusing to replace an existing runtime.env; smoke requires a disposable checkout.' >&2
    exit 1
fi
compose=(docker compose --env-file deploy/runtime.env -f deploy/compose.yml)
cleanup() {
    result=$?
    if [[ $result != 0 ]]; then
        "${compose[@]}" logs --tail=100 || true
    fi
    "${compose[@]}" down --volumes --remove-orphans || true
    docker network rm "$EDGE_NETWORK" >/dev/null 2>&1 || true
    rm -f deploy/runtime.env
    exit "$result"
}
trap cleanup EXIT
cp deploy/runtime.env.example deploy/runtime.env
cat >> deploy/runtime.env <<'ENV'
DB_NAME=mobser_ci
DB_USER=mobser_ci
DB_PASSWORD=ci-disposable-database-password
SECRET_KEY=ci-only-smoke-secret-904b38568f687aa11d0d3ff4d960322234a340
NEXTAUTH_SECRET=ci-only-nextauth-secret-9130f6b524018185
NEXTAUTH_URL=http://localhost:18080
ALLOWED_HOSTS=localhost,127.0.0.1,backend
CORS_ALLOWED_ORIGINS=http://localhost:18080
CSRF_TRUSTED_ORIGINS=http://localhost:18080
ENV
chmod 600 deploy/runtime.env
docker network create "$EDGE_NETWORK" >/dev/null
if [[ "${CI_SMOKE_PULL:-true}" == true ]]; then
    "${compose[@]}" pull
fi
"${compose[@]}" up -d --wait --wait-timeout 120 db redis
"${compose[@]}" run --rm --no-deps backend python manage.py migrate --noinput
"${compose[@]}" up -d --wait --wait-timeout 180
python3 scripts/ci-smoke.py http://localhost:18080
