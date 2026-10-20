#!/usr/bin/env bash
# Ship the local working tree to the preview host, then build and roll the stack there.
# Run from the developer machine: deploy/preview/push.sh
set -euo pipefail
HOST=${PREVIEW_SSH:-root@168.231.116.193}
BASE=${PREVIEW_BASE:-/srv/quran-preview}
cd "$(dirname "$0")/../.."
stamp=$(date -u +%Y%m%d-%H%M%S)
sha=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
tag="$stamp-$sha"
echo "shipping working tree as $tag to $HOST:$BASE"
tar -czf - \
    --exclude=./.git \
    --exclude=node_modules --exclude=.next --exclude=__pycache__ --exclude=.venv --exclude=venv \
    --exclude=.env --exclude=.env.prod --exclude=.env.local --exclude='*.sqlite3' \
    --exclude=./deploy/runtime.env \
    --exclude=./backend/_testout.txt --exclude=./backend/test-run-output.txt \
    . | ssh "$HOST" "set -e
        mkdir -p '$BASE'; chmod 700 '$BASE'
        rm -rf '$BASE/src.new'; mkdir -p '$BASE/src.new'
        tar -xzf - -C '$BASE/src.new'
        rm -rf '$BASE/src.prev'
        [ -d '$BASE/src' ] && mv '$BASE/src' '$BASE/src.prev' || true
        mv '$BASE/src.new' '$BASE/src'
        echo '$tag' > '$BASE/src/.preview-tag'
        chmod +x '$BASE'/src/deploy/preview/*.sh"
ssh "$HOST" "'$BASE/src/deploy/preview/bootstrap.sh' && '$BASE/redeploy.sh' '$tag'"
