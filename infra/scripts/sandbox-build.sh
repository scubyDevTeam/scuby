#!/usr/bin/env bash
# Builds both images locally for linux/arm64, so the slow part happens before any resource exists.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
docker build --platform linux/arm64 -t scuby/postgres:17 "$REPO/infra/docker/postgres"
cd "$REPO/backend"
export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH
./mvnw -q -B -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64
docker image inspect scuby/postgres:17 scuby-backend --format '{{.RepoTags}} {{.Architecture}}'
for img in scuby/postgres:17 scuby-backend; do
  arch=$(docker image inspect "$img" --format '{{.Architecture}}')
  [ "$arch" = "arm64" ] || { echo "ERROR: $img is $arch, expected arm64" >&2; exit 1; }
done
ZIP="$REPO/infra/lambda/media/dist/media-lambdas.zip"
[ -f "$ZIP" ] || "$REPO/infra/lambda/media/build.sh"
[ -f "$ZIP" ] || { echo "ERROR: $ZIP missing after build" >&2; exit 1; }
