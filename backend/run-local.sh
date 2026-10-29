#!/usr/bin/env bash
# Runs the whole backend locally in Docker: Postgres + the API (profile local), as this checkout's
# own compose project. Usage (from anywhere): bash backend/run-local.sh       Stop: bash backend/run-local.sh down
# Ports: SCUBY_DB_PORT (default 5433), SCUBY_API_PORT (default 8080).
set -euo pipefail
cd "$(dirname "$0")"

export COMPOSE_PROJECT_NAME="$(bash compose-project.sh)"
export SCUBY_IMAGE_TAG="${COMPOSE_PROJECT_NAME#scuby-backend-}"
export SCUBY_DB_PORT="${SCUBY_DB_PORT:-5433}"
export SCUBY_API_PORT="${SCUBY_API_PORT:-8080}"

if [[ "${1:-}" == "down" ]]; then
  docker compose --profile app down
  exit 0
fi

for port in "$SCUBY_DB_PORT" "$SCUBY_API_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 \
     && ! docker compose ps --format '{{.Publishers}}' 2>/dev/null | grep -q ":$port->"; then
    echo "port $port is taken by something outside project $COMPOSE_PROJECT_NAME (lsof -nP -iTCP:$port -sTCP:LISTEN)."
    echo "Stop it, or choose another port: SCUBY_DB_PORT=… SCUBY_API_PORT=… bash $0"
    exit 1
  fi
done

# Java 25 (backend/.java-version); the Maven enforcer refuses any other JDK.
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"

# The build needs Docker (jOOQ codegen) and the image scuby/postgres:17.
docker image inspect scuby/postgres:17 >/dev/null 2>&1 || docker build -t scuby/postgres:17 ../infra/docker/postgres

./mvnw -q -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64 -Djib.to.image="scuby-backend:${SCUBY_IMAGE_TAG}"
docker compose --profile app up -d --wait

health="http://localhost:${SCUBY_API_PORT}/actuator/health"
for _ in $(seq 1 90); do
  if curl -sf "$health" >/dev/null; then break; fi
  sleep 1
done
curl -sf "$health" || { echo "the API did not become healthy: COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose logs backend"; exit 1; }
echo
echo "Project: $COMPOSE_PROJECT_NAME"
echo "API:     http://localhost:${SCUBY_API_PORT}"
echo "Health:  $health"
echo "Stop:    bash $(pwd)/run-local.sh down"
