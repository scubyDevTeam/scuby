-- «Lo tengo»: someone says they have the lost animal (docs/product/04-lost-workflow.md · recovery_claim; L1 design §2.3).
-- Written only by the cases feature. Keyed by case_code like sighting (the product doc's case_id is the code).
-- The claimant is always a person: «Lo tengo» needs a session. No device column, no note column (the contract's claim
-- request has no note; a later contract change adds it with its own migration).
-- lat/lng: the point, filled only from from_sighting_id (the request carries no point). Photos are stored, not exposed
-- (open item O36). last_active_at: when the claimant last said «Lo tengo» on this claim (set at insert; a repeat while
-- the claim is open refreshes it). `stale` is not stored: a claim is stale when status = 'open' and last_active_at + 7 days
-- is in the past (ClaimDerivation.STALE_AFTER). No ON DELETE action on the foreign keys: the purge and account deletion
-- (L2) decide.
CREATE TABLE recovery_claim (
  id                  uuid PRIMARY KEY,
  case_code           text NOT NULL REFERENCES lost_case (code),
  claimant_person_id  uuid NOT NULL REFERENCES person (id),
  phone               text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  photo_urls          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_urls) <= 5),
  lat                 double precision CHECK (lat BETWEEN -90 AND 90),
  lng                 double precision CHECK (lng BETWEEN -180 AND 180),
  from_sighting_id    uuid REFERENCES sighting (id),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'dismissed')),
  created_at          timestamptz NOT NULL,
  last_active_at      timestamptz NOT NULL,
  answered_at         timestamptz,
  CONSTRAINT recovery_claim_point_both_or_none CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT recovery_claim_answered_when_not_open CHECK ((status = 'open') = (answered_at IS NULL))
);

-- Integrity index (justified by its rule, not by growth): one open claim per claimant per case. It settles the
-- double-tap race: the claim is one INSERT … SELECT … ON CONFLICT (case_code, claimant_person_id) WHERE status = 'open'
-- DO UPDATE (the repeat refreshes phone, photos, point, link and last_active_at of the open row and returns its id).
-- "Open" is the stored status, so a stale claim still holds the slot (a repeat makes it fresh again). Write cost: one
-- entry per open claim; it leaves the index when the owner answers.
-- Overlap: recovery_claim_by_case_recent_idx (V20261101_1030) shares the case_code prefix but is not unique and covers
-- every status. Needs human approval before merge.
CREATE UNIQUE INDEX recovery_claim_one_open_per_claimant
  ON recovery_claim (case_code, claimant_person_id) WHERE status = 'open';
