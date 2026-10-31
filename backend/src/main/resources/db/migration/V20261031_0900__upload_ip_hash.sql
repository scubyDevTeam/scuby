-- Upload slots get a second rate-limit key, the caller's IP (docs/eng/api.md · Uploads; docs/eng/backend.md · Rate limits on rows).
-- owner_key is client-controlled (a script that sends no cookies gets a new device, so a new 'd:' key, on every request),
-- so the per-caller cap alone does not bound the presigned 10 MB PUTs one machine can ask for. ip_hash is the same HMAC of
-- the client address the sighting limits use (ClientAddress + Hashing); it is kept only for this count.
-- Rows that predate the column (development databases only: nothing is deployed) get the all-zero hash, which no real IP hashes to.
ALTER TABLE upload ADD COLUMN ip_hash text NOT NULL DEFAULT repeat('0', 64) CHECK (ip_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE upload ALTER COLUMN ip_hash DROP DEFAULT;
