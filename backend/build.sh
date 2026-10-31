#!/usr/bin/env bash
# Builds the backend with only Docker on the host (no JDK): Maven runs inside a container, then the
# runtime image scuby-backend:${SCUBY_IMAGE_TAG:-local} is built from the jar.
# Usage (from anywhere): bash backend/build.sh [--verify]
#   default   ./mvnw -B package -DskipTests   (jOOQ codegen runs, tests do not)
#   --verify  ./mvnw -B verify                (codegen + the full test suite + PIT)
set -euo pipefail
cd "$(dirname "$0")"

goal=(package -DskipTests)
[[ "${1:-}" == "--verify" ]] && goal=(verify)
tag="${SCUBY_IMAGE_TAG:-local}"
maven_image="${SCUBY_MAVEN_IMAGE:-maven:3.9-eclipse-temurin-25}" # keep the JDK major equal to <java.version> in pom.xml

repo="$(git rev-parse --show-toplevel)"

# The codegen and the tests start Postgres from this local image, through the host's Docker daemon.
docker image inspect scuby/postgres:17 >/dev/null 2>&1 || docker build -t scuby/postgres:17 ../infra/docker/postgres

# Why each setting (Testcontainers runs inside this build container but starts siblings on the HOST daemon):
# - /var/run/docker.sock mounted: how Testcontainers reaches the daemon (the in-container default).
# - The whole repo is mounted at its own path layout: tests build the Postgres image from
#   ../infra/docker/postgres and read ../docs/eng/openapi.json.
# - TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal: the Postgres container's published port lives on
#   the host, not on the build container's localhost, so it is reached through the host's name. Docker
#   Desktop defines that name; on Linux it is added with host-gateway.
# - Ryuk (the cleanup sidecar) stays ON: it mounts the socket by its host path, which is the same
#   /var/run/docker.sock here, so it works and still removes the throwaway Postgres if the build dies.
# - Maven runs as root so it can use the socket on any host; target/ is chowned back to the caller after.
args=(--rm
  -v /var/run/docker.sock:/var/run/docker.sock
  -v "$repo":/work
  -v scuby-maven-cache:/m2
  -w /work/backend
  -e MAVEN_USER_HOME=/m2
  -e MAVEN_CONFIG=-Dmaven.repo.local=/m2/repository
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)")
[[ "$(docker info --format '{{.OperatingSystem}}')" == "Docker Desktop" ]] || args+=(--add-host=host.docker.internal:host-gateway)

# shellcheck disable=SC2016 # expanded by the container's shell
docker run "${args[@]}" "$maven_image" bash -c '
  status=0
  ./mvnw -B "$@" || status=$?
  chown -R "$HOST_UID:$HOST_GID" target 2>/dev/null || true
  exit $status' _ "${goal[@]}"

arch="$(docker info --format '{{.Architecture}}')"
case "$arch" in
  aarch64|arm64) platform=linux/arm64 ;;
  x86_64|amd64)  platform=linux/amd64 ;;
  *) echo "build.sh: unsupported Docker architecture '$arch'" >&2; exit 1 ;;
esac
docker build --platform "$platform" -t "scuby-backend:$tag" .
echo "Built scuby-backend:$tag ($platform)"
