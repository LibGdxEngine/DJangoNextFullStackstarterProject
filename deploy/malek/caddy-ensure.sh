#!/bin/sh
# Keep the company Caddy attached to the academy network and carrying the academy site block.
# The company release process recreates its Caddy container from a new release directory,
# which drops both; this runs from a one-minute root timer and repairs them.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
BASE=${MALEK_BASE:-/srv/malek-academy}
CADDY=${COMPANY_CADDY:-mobser-prod-caddy-1}
CADDYFILE=${COMPANY_CADDYFILE:-/opt/ic-mobile/current/caddy/Caddyfile}
NET=malek_academy_edge
MARK='# malek-academy'
test "$(id -u)" = 0 || exit 1
exec 9>/run/malek-academy-caddy-ensure.lock
flock -n 9 || exit 0
docker inspect "$CADDY" >/dev/null 2>&1 || exit 0
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$CADDY" | grep -q "\"$NET\""; then
    docker network connect "$NET" "$CADDY"
    echo "attached $CADDY to $NET"
fi
test -f "$CADDYFILE" || { echo "company Caddyfile missing: $CADDYFILE" >&2; exit 1; }
if ! grep -qF "$MARK" "$CADDYFILE"; then
    # Validate the combined config inside the container before touching the live file,
    # so a bad block can never break the company site.
    tmp=$(mktemp)
    trap 'rm -f "$tmp"' EXIT
    cat "$CADDYFILE" "$BASE/caddy-site.caddy" > "$tmp"
    docker cp "$tmp" "$CADDY:/tmp/malek-academy-check.Caddyfile"
    docker exec "$CADDY" caddy validate --config /tmp/malek-academy-check.Caddyfile --adapter caddyfile >/dev/null
    docker exec "$CADDY" rm -f /tmp/malek-academy-check.Caddyfile
    mkdir -p "$BASE/backups"
    cp -p "$CADDYFILE" "$BASE/backups/Caddyfile.$(date -u +%Y%m%d-%H%M%S)"
    # Append in place: the container holds a single-file bind mount, so the inode must not change.
    cat "$BASE/caddy-site.caddy" >> "$CADDYFILE"
    docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    echo "appended academy site block and reloaded $CADDY"
fi
