#!/usr/bin/env bash
# Builds both images locally for linux/arm64, so the slow part happens before any resource exists.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
docker build --platform linux/arm64 -t scuby/postgres:17 "$REPO/infra/docker/postgres"
cd "$REPO/backend"
export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH
./mvnw -q -B -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64
docker image inspect scuby/postgres:17 scuby-backend --format '{{.RepoTags}} {{.Architecture}}'
