-- Country is configuration, never code (docs/eng/auth.md · Country is configuration). One row per
-- country; adding one is a row plus a legal review. mobile_pattern matches the national significant
-- number (the digits after phone_prefix). default_center is where maps open (GET /config).
-- phone_prefix is not UNIQUE: several countries share a calling code (+1, +7), and the table is a handful of
-- rows read whole. SupportedCountries.forE164 picks the longest matching prefix, then sort_order, then code.
CREATE TABLE supported_countries (
  code                char(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  phone_prefix        text NOT NULL CHECK (phone_prefix ~ '^\+[1-9][0-9]{0,3}$'),
  mobile_pattern      text NOT NULL,
  currency            char(3) NOT NULL,
  locale              text NOT NULL,
  default_center_lat  double precision NOT NULL CHECK (default_center_lat BETWEEN -90 AND 90),
  default_center_lng  double precision NOT NULL CHECK (default_center_lng BETWEEN -180 AND 180),
  sort_order          int NOT NULL DEFAULT 0
);

-- v1: Colombia. Map center = Medellín, as the client's emulated backend (web/src/mocks/api/reads.ts).
INSERT INTO supported_countries (code, phone_prefix, mobile_pattern, currency, locale, default_center_lat, default_center_lng, sort_order)
VALUES ('CO', '+57', '^3\d{9}$', 'COP', 'es-CO', 6.2442, -75.5812, 0);
