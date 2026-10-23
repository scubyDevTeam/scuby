#!/usr/bin/env bash
# Builds the image, starts it, and checks that PostGIS installs. Exit non-zero on failure.
set -euo pipefail
cd "$(dirname "$0")"
docker build -t scuby/postgres:17 .
cid=$(docker run -d -e POSTGRES_PASSWORD=verify scuby/postgres:17)
trap 'docker rm -f "$cid" >/dev/null' EXIT
for _ in $(seq 1 30); do
  docker exec "$cid" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$cid" psql -U postgres -v ON_ERROR_STOP=1 -tAc \
  "CREATE EXTENSION postgis; SELECT postgis_lib_version();"
echo "OK: postgis installs on $(docker exec "$cid" uname -m)"
