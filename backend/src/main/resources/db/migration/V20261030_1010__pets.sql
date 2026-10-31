-- The pet record every vertical shares, and who is responsible for it
-- (docs/product/01-actors-and-entities.md; docs/product/04-lost-workflow.md · Publishing).
-- Written only by the pets feature. pet_is_lost is derived from cases, never stored.
CREATE TABLE pet (
  id             uuid PRIMARY KEY,
  name           text CHECK (length(name) BETWEEN 1 AND 60),
  species        text NOT NULL CHECK (species IN ('dog', 'cat', 'other')),
  size           text CHECK (size IN ('small', 'medium', 'large')),
  colors         text[] NOT NULL DEFAULT '{}'
                   CHECK (colors <@ ARRAY['black', 'white', 'brown', 'tan', 'gray', 'yellow', 'orange']
                          AND cardinality(colors) <= 7),   -- the 7 known colours, each at most once (Pets.createOwned de-duplicates)
  marks          text CHECK (length(marks) <= 500),
  chip_number    text CHECK (length(chip_number) <= 40),
  photo_urls     text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_urls) <= 6),
  custody_state  text NOT NULL CHECK (custody_state IN ('claimed', 'unclaimed', 'org_held')),
  created_at     timestamptz NOT NULL
);

CREATE TABLE responsibility_link (
  id           uuid PRIMARY KEY,
  person_id    uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  pet_id       uuid NOT NULL REFERENCES pet (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner')),
  active_from  timestamptz NOT NULL,
  active_to    timestamptz
);

-- An invariant, not a performance index: a pet has at most one active owner. It also serves the
-- ownership check (WHERE pet_id = ? AND role = 'owner' AND active_to IS NULL). Write cost: one
-- entry per owner link (one per pet). Needs human approval before merge.
CREATE UNIQUE INDEX responsibility_link_one_active_owner
  ON responsibility_link (pet_id) WHERE role = 'owner' AND active_to IS NULL;
