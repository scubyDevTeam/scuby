-- «Lo vi» sightings on a lost case (docs/product/04-lost-workflow.md · Sightings, Validation).
-- Written only by the cases feature. Visible at once; the owner may hide (status) or highlight.
-- Reporter = reporter_person_id when signed in, else the device (reporter_device_hash); the IP is
-- kept only as an HMAC (reporter_ip_hash) for the second rate-limit key. contact_phone is owner-only.
-- (case_code, client_id) is the replay key of an offline retry (docs/eng/api.md · Conventions); its
-- unique index also serves "a case's sightings" (case_code prefix) — no separate index needed.
-- No geography column: nothing in the slice reads a sighting's point spatially (the 30 km check
-- measures the request point against lost_case.last_seen_point). Add one with its first consumer
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
  reporter_ip_hash      text NOT NULL CHECK (reporter_ip_hash ~ '^[0-9a-f]{64}$'),
  contact_phone         text CHECK (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  status                text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden_by_owner', 'removed_by_moderation')),
  highlighted_by_owner  boolean NOT NULL DEFAULT false,
  client_id             text CHECK (length(client_id) BETWEEN 8 AND 64),
  CONSTRAINT sighting_replay_key UNIQUE (case_code, client_id)
);
