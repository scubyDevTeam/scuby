-- Accounts and sessions (docs/eng/auth.md · Sign-in, Profile; docs/eng/backend.md · Sessions).
-- person: one row per account, born lazily at sign-in. No password column, ever.
CREATE TABLE person (
  id                 uuid PRIMARY KEY,
  display_name       text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  email              text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  google_sub         text UNIQUE,
  phone              text CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  phone_verified_at  timestamptz,
  city               text,
  bio                text CHECK (length(bio) <= 280),
  notify_lost        boolean NOT NULL DEFAULT true,
  notify_found       boolean NOT NULL DEFAULT true,
  notify_adoption    boolean NOT NULL DEFAULT true,
  notify_help        boolean NOT NULL DEFAULT true,
  photo_url          text,
  created_at         timestamptz NOT NULL,
  CHECK (phone_verified_at IS NULL OR phone IS NOT NULL)
);

-- session: an opaque 256-bit token; only its SHA-256 is stored. Absolute expiry 12 months after
-- sign-in; reading a session never writes. No index on person_id yet: it is earned when account
-- deletion (which cascades here) or "sign out everywhere" lands.
CREATE TABLE session (
  token_hash  text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  person_id   uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL
);

ALTER TABLE feature_flag_overrides
  ADD CONSTRAINT feature_flag_overrides_person_fk FOREIGN KEY (person_id) REFERENCES person (id) ON DELETE CASCADE;
