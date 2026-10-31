-- Feature flags: global value, per-account overrides, append-only history (docs/eng/feature-flags.md · Model).
-- Operators flip flags with plain UPDATEs; triggers record every change so none is lost from the history.
CREATE TABLE feature_flags (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  enabled      boolean NOT NULL,
  description  text NOT NULL,
  owner        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- person_id gets its foreign key with the person table (V20261029_1020).
CREATE TABLE feature_flag_overrides (
  flag_key    text NOT NULL REFERENCES feature_flags (key) ON DELETE CASCADE,
  person_id   uuid NOT NULL,
  enabled     boolean NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_key, person_id)
);

CREATE TABLE feature_flag_changes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flag_key    text NOT NULL,
  person_id   uuid NULL,
  old         boolean NULL,
  new         boolean NULL,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION scuby.record_feature_flag_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.enabled IS NOT DISTINCT FROM NEW.enabled THEN
    RETURN NEW;
  END IF;
  INSERT INTO scuby.feature_flag_changes (flag_key, person_id, old, new, changed_by)
  VALUES (NEW.key, NULL, CASE WHEN TG_OP = 'UPDATE' THEN OLD.enabled END, NEW.enabled,
          coalesce(nullif(current_setting('scuby.changed_by', true), ''), current_user));
  RETURN NEW;
END $$;

CREATE TRIGGER feature_flags_history AFTER INSERT OR UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION scuby.record_feature_flag_change();

CREATE FUNCTION scuby.record_feature_flag_override_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.enabled IS NOT DISTINCT FROM NEW.enabled THEN
    RETURN NEW;
  END IF;
  INSERT INTO scuby.feature_flag_changes (flag_key, person_id, old, new, changed_by)
  VALUES (CASE WHEN TG_OP = 'DELETE' THEN OLD.flag_key ELSE NEW.flag_key END,
          CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.enabled END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.enabled END,
          coalesce(nullif(current_setting('scuby.changed_by', true), ''), current_user));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER feature_flag_overrides_history AFTER INSERT OR UPDATE OR DELETE ON feature_flag_overrides
  FOR EACH ROW EXECUTE FUNCTION scuby.record_feature_flag_override_change();

-- The registry (docs/eng/feature-flags.md · Registry). Code side: co.scuby.platform.flags.Flag.
INSERT INTO feature_flags (key, enabled, description, owner) VALUES
  ('publisher_phone_otp', true,
   'SMS OTP verification of the publisher''s phone at publish. Permanent kill switch (also the lever if the SMS spend alarm fires).',
   'founders'),
  ('reverse_geocoding', false,
   'Place names from a reverse-geocoding provider instead of the generic label. Deleted once a provider is chosen and stable.',
   'founders');
