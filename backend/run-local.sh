#!/usr/bin/env bash
# Runs the whole backend locally in Docker: Postgres + the API (profile local), as this checkout's
# own compose project. Usage (from anywhere): bash backend/run-local.sh       Stop: bash backend/run-local.sh down
# Ports: SCUBY_DB_PORT (default 5433), SCUBY_API_PORT (default 8080).
set -euo pipefail
cd "$(dirname "$0")"

# Assign first, then check: `export X="$(…)"` would mask a failure and compose would fall back to the
# shared default project (`backend`), which `down` must never touch.
project="$(bash compose-project.sh)" || { echo "run-local.sh: cannot determine the compose project name" >&2; exit 1; }
[[ -n "$project" ]] || { echo "run-local.sh: empty compose project name" >&2; exit 1; }
export COMPOSE_PROJECT_NAME="$project"
export SCUBY_IMAGE_TAG="${COMPOSE_PROJECT_NAME#scuby-backend-}" # build.sh tags the image with it
export SCUBY_DB_PORT="${SCUBY_DB_PORT:-5433}"
export SCUBY_API_PORT="${SCUBY_API_PORT:-8080}"

if [[ "${1:-}" == "down" ]]; then
  docker compose --profile app down
  exit 0
fi

# A port is acceptable if free, or if it is published by this project's own container.
check_port() { # <host port> <service> <container port>
  local published
  published="$(docker compose --profile app port "$2" "$3" 2>/dev/null || true)"
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 && [[ "$published" != *":$1" ]]; then
    echo "port $1 is taken by something outside project $COMPOSE_PROJECT_NAME (lsof -nP -iTCP:$1 -sTCP:LISTEN)."
    echo "Stop it, or choose another port: SCUBY_DB_PORT=… SCUBY_API_PORT=… bash $0"
    exit 1
  fi
}
check_port "$SCUBY_DB_PORT" postgres 5432
check_port "$SCUBY_API_PORT" backend 8080

# Build (Maven in a container, then the runtime image): only Docker is needed on the host.
bash build.sh
docker compose --profile app up -d --wait

health="http://localhost:${SCUBY_API_PORT}/actuator/health"
for _ in $(seq 1 90); do
  if curl -sf --max-time 2 "$health" >/dev/null; then break; fi
  sleep 1
done
curl -sf --max-time 2 "$health" || { echo "the API did not become healthy: COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose logs backend"; exit 1; }
echo
echo "Project: $COMPOSE_PROJECT_NAME"
echo "API:     http://localhost:${SCUBY_API_PORT}"
echo "Health:  $health"
echo "Stop:    bash $(pwd)/run-local.sh down"
