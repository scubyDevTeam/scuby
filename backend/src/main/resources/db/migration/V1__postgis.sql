-- PostGIS lives in public; application tables live in the scuby schema (docs/eng/backend.md · Data access).
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
