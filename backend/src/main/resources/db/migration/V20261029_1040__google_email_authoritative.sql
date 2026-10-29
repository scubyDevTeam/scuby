-- Whether the email Google vouched for at link time was one Google is authoritative for: a gmail.com /
-- googlemail.com address, or a Workspace address whose `hd` claim equals its domain. A non-authoritative
-- link (e.g. a Google account made with a third-party address) is dropped when the mailbox owner signs
-- in with an email code. NULL exactly when there is no Google identity.
ALTER TABLE person ADD COLUMN google_email_authoritative boolean;
-- Links made before this column existed were not checked: treat them as non-authoritative.
UPDATE person SET google_email_authoritative = false WHERE google_sub IS NOT NULL;
ALTER TABLE person ADD CONSTRAINT person_google_authoritative_with_sub
  CHECK ((google_sub IS NULL) = (google_email_authoritative IS NULL));
