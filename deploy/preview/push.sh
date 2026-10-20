#!/usr/bin/env bash
# Ship the local working tree to the preview host, then build and roll the stack there.
# Run from the developer machine: deploy/preview/push.sh
# Routine updates deploy automatically from master (.github/workflows/preview.yml); use this
# to show clients uncommitted work or to deploy when GitHub Actions is unavailable.
set -euo pipefail
HOST=${PREVIEW_SSH:-root@168.231.116.193}
BASE=${PREVIEW_BASE:-/srv/quran-preview}
cd "$(dirname "$0")/../.."
stamp=$(date -u +%Y%m%d-%H%M%S)
sha=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
tag="$stamp-$sha"
echo "shipping working tree as $tag to $HOST:$BASE"
# receive.sh unpacks, bootstraps and redeploys on the host; ship the current copy first.
ssh "$HOST" "mkdir -p '$BASE' && chmod 700 '$BASE' && cat > '$BASE/.receive.sh.new' && mv -f '$BASE/.receive.sh.new' '$BASE/receive.sh'" \
    < deploy/preview/receive.sh
tar -czf - \
    --exclude=./.git \
    --exclude=node_modules --exclude=.next --exclude=__pycache__ --exclude=.venv --exclude=venv \
    --exclude=.env --exclude=.env.prod --exclude=.env.local --exclude='*.sqlite3' \
    --exclude=./deploy/runtime.env \
    --exclude=./backend/_testout.txt --exclude=./backend/test-run-output.txt \
    . | ssh "$HOST" "sh '$BASE/receive.sh' '$tag'"
