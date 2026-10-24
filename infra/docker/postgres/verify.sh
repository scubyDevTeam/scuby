#!/usr/bin/env bash
# Builds the image, starts it, and checks that PostGIS installs. Exit non-zero on failure.
set -euo pipefail
cd "$(dirname "$0")"
docker build -t scuby/postgres:17 .
cid=$(docker run -d -e POSTGRES_PASSWORD=verify scuby/postgres:17)
trap 'docker rm -f "$cid" >/dev/null' EXIT
# Check over TCP: during init the entrypoint runs a temporary server on the Unix socket only.
ready=0
for _ in $(seq 1 30); do
  if docker exec "$cid" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "FAIL: postgres not ready over TCP after 30s" >&2
  docker logs "$cid" >&2
  exit 1
fi
docker exec "$cid" psql -U postgres -v ON_ERROR_STOP=1 -tAc \
  "CREATE EXTENSION postgis; SELECT postgis_lib_version();"
echo "OK: postgis installs on $(docker exec "$cid" uname -m)"
