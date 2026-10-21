#!/bin/sh
# Receive a source tarball (gzip) on stdin, install it as $BASE/src, then bootstrap and redeploy.
# Root only. Called by push.sh from the developer machine.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
BASE=${MALEK_BASE:-/srv/malek-academy}
tag=${1:?usage: receive.sh <tag> < source.tar.gz}
case "$tag" in
    *[!0-9A-Za-z.-]* | -* | '') echo "invalid tag: $tag" >&2; exit 2 ;;
esac
test ${#tag} -le 64 || { echo "tag too long" >&2; exit 2; }
test "$(id -u)" = 0 || { echo "root required" >&2; exit 1; }
umask 077
mkdir -p "$BASE"
chmod 700 "$BASE"
cd "$BASE"
# Serialize whole receive+deploy runs; redeploy.sh holds its own lock for the rollout.
exec 8>"$BASE/.receive.lock"
flock -w 1800 8 || { echo "timed out waiting for another deploy" >&2; exit 1; }

echo "== receiving source $tag"
rm -rf src.new
mkdir src.new
tar -xzf - -C src.new --no-same-owner
test -f src.new/deploy/malek/bootstrap.sh || { echo "tarball is not the quran_platform tree" >&2; exit 1; }
rm -rf src.prev
if [ -d src ]; then mv src src.prev; fi
mv src.new src
echo "$tag" > src/.release-tag

sh "$BASE/src/deploy/malek/bootstrap.sh"
exec sh "$BASE/redeploy.sh" "$tag"
