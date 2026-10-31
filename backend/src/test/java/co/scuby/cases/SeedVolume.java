package co.scuby.cases;

import org.jooq.DSLContext;

/** Thousands of rows for plan checks. Codes C0001…CFFFF (hex, so 5 characters up to 65,535 cases); cases spread over ~0.5° around Medellín; 10 % active. */
final class SeedVolume {

    private SeedVolume() {}

    static void casesAndSightings(DSLContext db, int cases, int sightings) {
        db.execute("INSERT INTO scuby.person (id, display_name, email, created_at) VALUES ('00000000-0000-0000-0000-000000000001', 'Seed', 'seed@x.co', now()) ON CONFLICT DO NOTHING");
        db.execute("""
                INSERT INTO scuby.pet (id, name, species, custody_state, created_at)
                SELECT ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'P' || g,
                       (ARRAY['dog','cat','other'])[1 + g % 3], 'claimed', now()
                FROM generate_series(1, ?) g""", cases);
        db.execute("""
                INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, contact_phone, contact_phone_verified, phone_has_whatsapp,
                  expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_radius_m, last_seen_at)
                SELECT 'C' || upper(lpad(to_hex(g), 4, '0')), ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid,
                  '00000000-0000-0000-0000-000000000001', CASE WHEN g % 10 = 0 THEN 'active' ELSE 'expired' END,
                  timestamptz '2026-01-01' + g * interval '2 hours', '+573007152284', true, true, true, false, false,
                  6.0 + (g % 97) * 0.005, -75.8 + (g % 89) * 0.005, 300, timestamptz '2026-01-01' + g * interval '2 hours'
                FROM generate_series(1, ?) g""", cases);
        db.execute("""
                INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_person_id,
                  reporter_device_hash, reporter_ip_hash, status)
                SELECT gen_random_uuid(), 'C' || upper(lpad(to_hex(1 + g % ?), 4, '0')), 6.25, -75.59,
                  timestamptz '2026-01-01' + g * interval '5 minutes', timestamptz '2026-01-01' + g * interval '5 minutes',
                  CASE WHEN g % 4 = 0 THEN '00000000-0000-0000-0000-000000000001'::uuid END,
                  md5((g % 3000)::text) || md5('d'), md5((g % 700)::text) || md5('i'),
                  CASE WHEN g % 10 = 0 THEN 'hidden_by_owner' ELSE 'visible' END
                FROM generate_series(1, ?) g""", cases, sightings);
        db.execute("ANALYZE scuby.lost_case");
        db.execute("ANALYZE scuby.sighting");
        db.execute("ANALYZE scuby.pet");
    }
}
