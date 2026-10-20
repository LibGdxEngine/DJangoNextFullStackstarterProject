#!/bin/sh
# SSH forced command for the GitHub Actions preview key (see README). The only accepted
# request is "deploy <tag>" with the source tarball on stdin; everything else is refused.
set -euf
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
BASE=${PREVIEW_BASE:-/srv/quran-preview}
request=${SSH_ORIGINAL_COMMAND:-}
case "$request" in
    *[!0-9A-Za-z.\ -]*) echo "refused" >&2; exit 2 ;;
esac
# shellcheck disable=SC2086 # word splitting is intended; globbing is off (set -f)
set -- $request
if [ $# -ne 2 ] || [ "$1" != deploy ]; then
    echo "usage: deploy <tag>" >&2
    exit 2
fi
exec sh "$BASE/receive.sh" "$2"
