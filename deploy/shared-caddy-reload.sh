#!/bin/sh
# Administrator-only workaround for this VPS's stale single-file bind mount.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
test "$(id -u)" = 0
exec 9>/run/mobser-shared-caddy-reload.lock
flock -n 9
docker exec -i search_caddy sh -c 'cat > /config/shared-live.Caddyfile' \
    < /root/home/ILM_SHAMELA/caddy/Caddyfile
docker exec search_caddy caddy validate --config /config/shared-live.Caddyfile --adapter caddyfile
docker exec search_caddy caddy reload --config /config/shared-live.Caddyfile --adapter caddyfile
