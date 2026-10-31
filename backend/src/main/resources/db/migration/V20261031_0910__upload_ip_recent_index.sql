-- Upload slots, second rate-limit key (UploadSlots.recentSlotsQuery):
--   SELECT count(*) FILTER (WHERE owner_key = ?), count(*) FILTER (WHERE ip_hash = ?) FROM upload
--   WHERE (owner_key = ? OR ip_hash = ?) AND created_at > now - 10 min
-- Plan before (30,000 uploads, cost 1493): Seq Scan on upload. After: a bitmap union of upload_pkey (owner_key prefix) and
-- upload_by_ip_recent_idx. The primary key (owner_key, sha256, purpose) cannot serve the IP half: it does not lead with ip_hash.
-- Write cost: one entry per upload slot (a presign, a few per photo; the upsert of a repeated photo rewrites it only when created_at/ip_hash change,
-- which they always do, so a repeated slot costs one update with a new index entry).
-- Overlaps: none (upload_pkey leads with owner_key).
-- Needs human approval before merge.
CREATE INDEX upload_by_ip_recent_idx ON upload (ip_hash, created_at);
