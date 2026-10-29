-- Email sign-in codes (docs/eng/auth.md · Sign-in): one pending code per address, stored as an
-- HMAC; 5-minute expiry, 3 attempts, 60 s resend cooldown while the code is live, 10 sends per
-- address per UTC day. Lookups are by primary key only.
CREATE TABLE email_code (
  email         text PRIMARY KEY CHECK (email = lower(btrim(email))),
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  sent_at       timestamptz NOT NULL,
  sends_day     date NOT NULL,
  sends_on_day  int NOT NULL
);

-- code_send: the send log of both code channels (email sign-in, SMS OTP — docs/eng/auth.md · OTP
-- mechanics) behind the per-target, per-device and per-IP throttles and the SMS spend alarm. Rows
-- older than 30 days are purged (IdentityPurge). Devices and IPs are stored as hashes only.
CREATE TABLE code_send (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel      text NOT NULL CHECK (channel IN ('email', 'sms')),
  target       text NOT NULL,
  person_id    uuid REFERENCES person (id) ON DELETE SET NULL,
  device_hash  text NOT NULL,
  ip_hash      text NOT NULL,
  sent_at      timestamptz NOT NULL
);
