-- «Lo vi» sightings on a lost case (docs/product/04-lost-workflow.md · Sightings, Validation).
-- Written only by the cases feature. Visible at once; the owner may hide (status) or highlight.
-- Reporter = reporter_person_id when signed in, else the device (reporter_device_hash): domain data,
-- read by `mine` and the 15-minute edit window. No IP is stored. contact_phone is owner-only.
-- (case_code, client_id) is the replay key of an offline retry (docs/eng/api.md · Conventions); it is an
-- integrity constraint, and it stays a UNIQUE. Reads go through sighting_by_case_recent_idx (below).
-- No geography column: nothing in the slice reads a sighting's point spatially (the 30 km check
-- measures the request point against lost_case.last_seen_public_point). Add one with its first consumer
-- (trajectory, orphan matching).
CREATE TABLE sighting (
  id                    uuid PRIMARY KEY,
  case_code             text NOT NULL REFERENCES lost_case (code),
  lat                   double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                   double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  seen_at               timestamptz NOT NULL,
  created_at            timestamptz NOT NULL,
  note                  text CHECK (length(note) <= 500),
  photo_urls            text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_urls) <= 3),
  reporter_person_id    uuid REFERENCES person (id) ON DELETE SET NULL,
  reporter_device_hash  text NOT NULL CHECK (reporter_device_hash ~ '^[0-9a-f]{64}$'),
  contact_phone         text CHECK (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  status                text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden_by_owner', 'removed_by_moderation')),
  highlighted_by_owner  boolean NOT NULL DEFAULT false,
  client_id             text CHECK (length(client_id) BETWEEN 8 AND 64),
  CONSTRAINT sighting_replay_key UNIQUE (case_code, client_id)
);

-- Performance index (decision 68, amends 53). Growth answers (backend/CLAUDE.md · Migrations and indexes):
--   1. Can the table grow without bound? Yes: sightings are never deleted, and «Lo vi» has no rate limit
--      (deferred, decision 54), so a script can put hundreds of thousands of rows on one case.
--   2. How often does the query run? On every case view (LostCaseQueries.sightingsQuery: the newest 200 sightings
--      the viewer may see, ORDER BY seen_at DESC, id DESC LIMIT 200, decision 64) and, per feed row, the two
--      correlated subqueries of FeedQueries (count of visible sightings, max(seen_at)).
--   3. Without it: the list reads and sorts every sighting of the case to return 200 (plan before, one case of
--      20,000 sightings: Limit > Sort (seen_at DESC, id DESC) > Seq Scan on sighting, cost 1684); the feed's
--      counts used the replay key, which finds the case's rows but not in time order and not their status.
--   Plan after: Limit > Index Scan using sighting_by_case_recent_idx: a top-N in index order, no Sort, 200 rows
--   read whatever the case's size. The feed counts become Index Only Scans on the same index (status is INCLUDEd so
--   no heap visit): count(*) still visits every entry of the case (acceptable: it reads the narrow index only,
--   and the true count is a product rule, decision 64), max(seen_at) reads the first visible entry.
-- Not partial: the owner's list is "not removed by moderation" (hidden ones included) and the public one is
-- "visible", so no single literal predicate serves both; status is filtered inside the index entry instead.
-- Write cost: one more btree entry (text, timestamptz, uuid + status) per sighting insert and per change of
-- status (the owner hiding one); sightings are low-volume writes.
-- Overlap: sighting_replay_key (case_code, client_id) shares the case_code prefix. With this index its prefix is
-- redundant for reads (every read by case_code is served here), but it stays: it is the UNIQUE that settles the
-- replay race (INSERT ... ON CONFLICT) and serves the replay lookup (case_code, client_id).
-- Plan check (RED without the index): CaseSightingsPlanTest. Needs human approval before merge.
CREATE INDEX sighting_by_case_recent_idx ON sighting (case_code, seen_at DESC, id DESC) INCLUDE (status);
