# Postgres 17 + PostGIS 3, multi-arch (docs/eng/infra.md · Database).
# pgvector joins here when photo matching needs it (open item O7).
FROM postgres:17

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-17-postgis-3 \
      postgresql-17-postgis-3-scripts \
 && rm -rf /var/lib/apt/lists/*
