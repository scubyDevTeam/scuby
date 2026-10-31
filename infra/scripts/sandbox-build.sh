#!/usr/bin/env bash
# Builds both images locally for linux/arm64, so the slow part happens before any resource exists.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
docker build --platform linux/arm64 -t scuby/postgres:17 "$REPO/infra/docker/postgres"
# Maven runs in a container on the host's native architecture; only the runtime image is built for arm64.
# The tag "latest" makes the local image name plain scuby-backend, which sandbox-deploy.sh tags for ECR.
SCUBY_IMAGE_TAG=latest bash "$REPO/backend/build.sh" --platform linux/arm64
docker image inspect scuby/postgres:17 scuby-backend --format '{{.RepoTags}} {{.Architecture}}'
for img in scuby/postgres:17 scuby-backend; do
  arch=$(docker image inspect "$img" --format '{{.Architecture}}')
  [ "$arch" = "arm64" ] || { echo "ERROR: $img is $arch, expected arm64" >&2; exit 1; }
done
ZIP="$REPO/infra/lambda/media/dist/media-lambdas.zip"
[ -f "$ZIP" ] || "$REPO/infra/lambda/media/build.sh"
[ -f "$ZIP" ] || { echo "ERROR: $ZIP missing after build" >&2; exit 1; }
