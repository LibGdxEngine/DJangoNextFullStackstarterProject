#!/usr/bin/env bash
# Export the backend contract without connecting to the database or a broker.
set -euo pipefail

repository_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_dir"
mode="${1:-generate}"
if [[ "$mode" != generate && "$mode" != check ]]; then
    echo "Usage: $0 [generate|check]" >&2
    exit 2
fi
contract_dir="$(mktemp -d)"
trap 'rm -rf "$contract_dir"' EXIT

schema_args=(spectacular --settings=core.settings.schema --format=openapi-json --validate --fail-on-warn)
if [[ -n "${API_PYTHON:-}" ]]; then
    PYTHONDONTWRITEBYTECODE=1 "$API_PYTHON" backend/manage.py "${schema_args[@]}" > "$contract_dir/openapi.json"
else
    docker compose exec -T -e PYTHONDONTWRITEBYTECODE=1 backend python manage.py "${schema_args[@]}" > "$contract_dir/openapi.json"
fi
(
    cd frontend
    ./node_modules/.bin/openapi-typescript "$contract_dir/openapi.json" --output "$contract_dir/generated.ts"
)

if [[ "$mode" == check ]]; then
    drift=0
    for artifact in backend/openapi.json frontend/src/lib/api/generated.ts; do
        if ! cmp -s "$artifact" "$contract_dir/$(basename "$artifact")"; then
            echo "Stale API artifact: $artifact. Run make api-generate." >&2
            drift=1
        fi
    done
    exit "$drift"
fi
mkdir -p frontend/src/lib/api
cp "$contract_dir/openapi.json" backend/openapi.json
cp "$contract_dir/generated.ts" frontend/src/lib/api/generated.ts
echo 'Updated backend/openapi.json and frontend/src/lib/api/generated.ts.'
