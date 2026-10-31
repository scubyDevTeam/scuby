-- «Lo vi» rate limits (SightingQueries.reporterCountsQuery / ipCountsQuery):
--   SELECT count(*) FILTER (WHERE case_code = ?), count(*) FROM sighting
--   WHERE <reporter_person_id = ? | reporter_device_hash = ? | reporter_ip_hash = ?> AND created_at > now - 24 h
-- Plans before (40,000 sightings, cost 1850): Seq Scan on sighting for each of the three counts. After: an index range scan
-- per key over the last day's rows of that reporter or IP.
-- Write cost: three index entries per sighting (sightings are low-volume writes; reads per sighting
-- are 2 counts). The person index is partial (anonymous pins never need it).
-- Overlaps: sighting_replay_key (case_code, client_id) — different leading column, no overlap.
-- Need human approval before merge.
CREATE INDEX sighting_reporter_person_recent_idx ON sighting (reporter_person_id, created_at) WHERE reporter_person_id IS NOT NULL;
CREATE INDEX sighting_reporter_device_recent_idx ON sighting (reporter_device_hash, created_at);
CREATE INDEX sighting_reporter_ip_recent_idx ON sighting (reporter_ip_hash, created_at);
