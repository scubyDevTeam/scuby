-- Email sign-in codes (docs/eng/auth.md · Sign-in): one pending code per address, stored as an
-- HMAC; 5-minute expiry, 3 attempts, 60 s resend cooldown while the code is live. The cap of 10
-- sends per address in a rolling 24 h is counted over code_send. Lookups are by primary key only.
CREATE TABLE email_code (
  email         text PRIMARY KEY CHECK (email = lower(btrim(email))),
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  sent_at       timestamptz NOT NULL
);

-- code_send: the log of both code channels (email sign-in, SMS OTP — docs/eng/auth.md · OTP mechanics), two kinds of
-- row. kind 'send' is a code sent: behind the per-target rolling-24 h send caps (SMS 5, email 10) and the SMS spend
-- alarm. kind 'fail' is a wrong code that was checked against a live one: behind the cap of 10 failed checks per
-- target in a rolling 24 h, which a new code does not reset (docs/eng/auth.md · Guessing budget). A wrong check
-- with no live code writes nothing, so a failure row always follows a send row. Rows older than 30 days are purged
-- (IdentityPurge). Its index: V20261031_0940. Nothing about the requester is stored beyond the account, if any.
CREATE TABLE code_send (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel      text NOT NULL CHECK (channel IN ('email', 'sms')),
  target       text NOT NULL,
  person_id    uuid REFERENCES person (id) ON DELETE SET NULL,
  kind         text NOT NULL DEFAULT 'send' CHECK (kind IN ('send', 'fail')),
  sent_at      timestamptz NOT NULL
);
