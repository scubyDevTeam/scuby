-- Lost cases (docs/product/04-lost-workflow.md · The case; docs/product/10-sharing.md · codes).
-- Written only by the cases feature. The code is the case's identity and its URL (/c/7K3PQ); codes
-- are generated from 23456789ABCDEFGHJKMNPQRSTUVWXYZ and never reused (purged_case_code keeps
-- the purged ones so a printed poster still resolves: GET answers `gone`).
-- last_seen is an area: the stored radius is the owner's uncertainty; the 200 m public floor is
-- applied when answering, never stored. place_name NULL = render the generic localized label.
-- Points: lat/lng columns written by the app + a generated geography column for PostGIS.
CREATE TABLE lost_case (
  code                text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{5}$'),
  pet_id              uuid NOT NULL REFERENCES pet (id),
  created_by          uuid NOT NULL REFERENCES person (id),
  status              text NOT NULL CHECK (status IN ('active', 'reunited', 'expired', 'cancelled')),
  published_at        timestamptz NOT NULL,
  resolved_at         timestamptz,
  contact_phone       text NOT NULL CHECK (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  phone_has_whatsapp  boolean NOT NULL,
  expose_whatsapp     boolean NOT NULL,
  expose_email        boolean NOT NULL,
  in_app_only         boolean NOT NULL,
  last_seen_lat       double precision NOT NULL CHECK (last_seen_lat BETWEEN -90 AND 90),
  last_seen_lng       double precision NOT NULL CHECK (last_seen_lng BETWEEN -180 AND 180),
  last_seen_point     public.geography(Point, 4326) GENERATED ALWAYS AS
                        (public.ST_SetSRID(public.ST_MakePoint(last_seen_lng, last_seen_lat), 4326)::public.geography) STORED,
  last_seen_radius_m  double precision NOT NULL CHECK (last_seen_radius_m > 0 AND last_seen_radius_m <= 5000),
  last_seen_at        timestamptz NOT NULL,
  place_name          text
);

CREATE TABLE purged_case_code (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{5}$'),
  purged_at  timestamptz NOT NULL
);
