#!/usr/bin/env bash
# Runs web/e2e's sign-in, publish-lost and lost-case specs against the backend in Docker, in a compose
# project of its own (scuby-e2e-<checkout>: own containers, volume, image tag, database port).
# Usage: bash backend/e2e/run-client-e2e.sh [playwright config]   (default: backend/e2e/playwright.real.config.ts)
#        bash backend/e2e/run-client-e2e.sh --down                 (removes this project and its volume only)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
backend="$(dirname "$here")"
web="$(dirname "$backend")/web"
# Assign first, then check: a failed substitution must not leave compose on the shared default project.
project="$(bash "$backend/compose-project.sh")" || { echo "run-client-e2e.sh: cannot determine the checkout name" >&2; exit 1; }
checkout="${project#scuby-backend-}"
[[ -n "$checkout" && "$checkout" != "$project" ]] || { echo "run-client-e2e.sh: empty checkout name" >&2; exit 1; }

export COMPOSE_PROJECT_NAME="scuby-e2e-$checkout"
export SCUBY_DB_PORT="${SCUBY_E2E_DB_PORT:-55433}"
export SCUBY_API_PORT=8080
export SCUBY_IMAGE_TAG="e2e-$checkout"
compose=(docker compose -f "$backend/compose.yaml" -f "$here/compose.e2e.yaml")

if [[ "${1:-}" == "--down" ]]; then
  "${compose[@]}" --profile app down -v
  exit 0
fi
cfg="${1:-$here/playwright.real.config.ts}"
config="$(cd "$(dirname "$cfg")" && pwd)/$(basename "$cfg")"

# A previous run of this same project frees its own ports; anything else holding them is someone else's.
"${compose[@]}" --profile app down
for port in "$SCUBY_DB_PORT" "$SCUBY_API_PORT" 4173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port is in use by another process (see: lsof -nP -iTCP:$port -sTCP:LISTEN); free it and re-run" >&2
    exit 1
  fi
done

cd "$backend"
# Maven runs in a container (build.sh), so the host needs only Docker; it tags scuby-backend:$SCUBY_IMAGE_TAG.
bash ./build.sh
"${compose[@]}" --profile app up -d --wait
for _ in $(seq 1 90); do curl -sf --max-time 2 "http://localhost:$SCUBY_API_PORT/actuator/health" >/dev/null && break; sleep 1; done
curl -sf --max-time 2 "http://localhost:$SCUBY_API_PORT/actuator/health" >/dev/null || { echo "run-client-e2e.sh: the API did not become healthy on port $SCUBY_API_PORT" >&2; exit 1; }
"${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U scuby -d scuby < "$here/seed.sql"

cd "$web"
# pnpm may not be installed: run the version web/package.json pins through npx.
if command -v pnpm >/dev/null 2>&1; then pnpm_cmd=(pnpm); else pnpm_cmd=(npx --yes pnpm@10.27.0); fi
"${pnpm_cmd[@]}" install --frozen-lockfile
"${pnpm_cmd[@]}" exec playwright test --config "$config" --workers=1 --grep "@auth|@publish-lost|@case-link"
