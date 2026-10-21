#!/bin/sh
# Root systemd timer; repair only this application's edge attachment.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
docker inspect search_caddy >/dev/null 2>&1 || exit 0
started=$(docker inspect --format '{{.State.StartedAt}}' search_caddy)
marker=/srv/quran_app-test/caddy-started-at
if [ ! -f "$marker" ] || [ "$(cat "$marker")" != "$started" ]; then
    /usr/local/sbin/quran_app-shared-caddy-reload
    umask 077
    printf '%s\n' "$started" > "$marker"
fi
if ! docker inspect --format '{{json .NetworkSettings.Networks}}' search_caddy | grep -q '"quran_app_test_edge"'; then
    docker network connect quran_app_test_edge search_caddy
fi
