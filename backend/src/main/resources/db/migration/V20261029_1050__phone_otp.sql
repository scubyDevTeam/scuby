-- Phone OTP (docs/eng/auth.md · OTP mechanics). phone_otp: one pending code per (person, number),
-- stored as an HMAC; 5-minute expiry, 3 attempts, 60 s cooldown. The sends themselves are rows of
-- code_send (channel 'sms', V20261029_1030) behind the throttles (4 per number, 10 per device,
-- 20 per IP per rolling 24 h) and the spend alarm. No index beyond the primary key.
CREATE TABLE phone_otp (
  person_id   uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  phone       text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  sent_at     timestamptz NOT NULL,
  PRIMARY KEY (person_id, phone)
);
