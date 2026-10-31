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
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
docker image inspect scuby/postgres:17 >/dev/null 2>&1 || docker build -t scuby/postgres:17 ../infra/docker/postgres
# Build for the Docker host's architecture (the pom lists arm64 and amd64; dockerBuild needs one).
arch="$(docker info --format '{{.Architecture}}')"
case "$arch" in
  aarch64|arm64) platform=linux/arm64 ;;
  x86_64|amd64)  platform=linux/amd64 ;;
  *) echo "run-client-e2e.sh: unsupported Docker architecture '$arch'" >&2; exit 1 ;;
esac
./mvnw -q -DskipTests package jib:dockerBuild -Djib.from.platforms="$platform" -Djib.to.image="scuby-backend:$SCUBY_IMAGE_TAG"
"${compose[@]}" --profile app up -d --wait
for _ in $(seq 1 90); do curl -sf --max-time 2 "http://localhost:$SCUBY_API_PORT/actuator/health" >/dev/null && break; sleep 1; done
"${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U scuby -d scuby < "$here/seed.sql"

cd "$web"
# pnpm may not be installed: run the version web/package.json pins through npx.
if command -v pnpm >/dev/null 2>&1; then pnpm_cmd=(pnpm); else pnpm_cmd=(npx --yes pnpm@10.27.0); fi
"${pnpm_cmd[@]}" install --frozen-lockfile
"${pnpm_cmd[@]}" exec playwright test --config "$config" --workers=1 --grep "@auth|@publish-lost|@case-link"
