-- Upload slots (docs/eng/api.md · Uploads; decision #36): who took a slot for which photo and purpose.
-- A publish or sighting may attach only photos its caller took a slot for, for that purpose.
-- owner_key = 'p:<person uuid>' when signed in, else 'd:<device hash>' (no device table: backend.md · Security).
-- The primary key also serves the per-caller slot count (owner_key prefix) and the attach lookup.
CREATE TABLE upload (
  owner_key   text NOT NULL CHECK (owner_key ~ '^(p:[0-9a-f-]{36}|d:[0-9a-f]{64})$'),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  purpose     text NOT NULL CHECK (purpose IN ('pet', 'sighting', 'claim', 'evidence', 'profile')),
  bytes       int  NOT NULL CHECK (bytes BETWEEN 1 AND 10000000),
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (owner_key, sha256, purpose)
);
