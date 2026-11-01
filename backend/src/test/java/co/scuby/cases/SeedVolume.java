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
                  expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_public_lat, last_seen_public_lng, last_seen_radius_m, last_seen_at)
                SELECT 'C' || upper(lpad(to_hex(g), 4, '0')), ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid,
                  '00000000-0000-0000-0000-000000000001', CASE WHEN g % 10 = 0 THEN 'active' ELSE 'expired' END,
                  timestamptz '2026-01-01' + g * interval '2 hours', '+573007152284', true, true, true, false, false,
                  6.0 + (g % 97) * 0.005, -75.8 + (g % 89) * 0.005, 6.0 + (g % 97) * 0.005, -75.8 + (g % 89) * 0.005, 300, timestamptz '2026-01-01' + g * interval '2 hours'
                FROM generate_series(1, ?) g""", cases);
        db.execute("""
                INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_person_id,
                  reporter_device_hash, status)
                SELECT gen_random_uuid(), 'C' || upper(lpad(to_hex(1 + g % ?), 4, '0')), 6.25, -75.59,
                  timestamptz '2026-01-01' + g * interval '5 minutes', timestamptz '2026-01-01' + g * interval '5 minutes',
                  CASE WHEN g % 4 = 0 THEN '00000000-0000-0000-0000-000000000001'::uuid END,
                  md5((g % 3000)::text) || md5('d'),
                  CASE WHEN g % 10 = 0 THEN 'hidden_by_owner' ELSE 'visible' END
                FROM generate_series(1, ?) g""", cases, sightings);
        db.execute("ANALYZE scuby.lost_case");
        db.execute("ANALYZE scuby.sighting");
        db.execute("ANALYZE scuby.pet");
    }

    /**
     * Recovery claims for plan checks. 2,000 claimant persons (…0003-…). {@code claims} rows spread over the first
     * {@code cases} seeded cases (claim g → case 1 + g % cases, claimant 1 + (g / cases) % 1000, so a (case, claimant)
     * pair repeats only past 1,000 claims per case), a third of them open; plus {@code heavyClaims} rows on
     * {@code heavyCase} by claimants 1001–2000, the first 500 open. Then ANALYZE.
     */
    static void claims(DSLContext db, int cases, int claims, String heavyCase, int heavyClaims) {
        db.execute("""
                INSERT INTO scuby.person (id, display_name, email, created_at)
                SELECT ('00000000-0000-0000-0003-' || lpad(g::text, 12, '0'))::uuid, 'C' || g, 'c' || g || '@seed.co', now()
                FROM generate_series(1, 2000) g ON CONFLICT DO NOTHING""");
        db.execute("""
                INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at, answered_at)
                SELECT gen_random_uuid(), 'C' || upper(lpad(to_hex(1 + g % ?), 4, '0')),
                       ('00000000-0000-0000-0003-' || lpad((1 + (g / ?) % 1000)::text, 12, '0'))::uuid, '+573001112233',
                       CASE WHEN g % 3 = 0 THEN 'open' ELSE 'dismissed' END,
                       timestamptz '2026-06-01' + g * interval '1 minute',
                       timestamptz '2026-06-01' + g * interval '1 minute',
                       CASE WHEN g % 3 = 0 THEN NULL ELSE timestamptz '2026-06-01' + g * interval '1 minute' + interval '1 hour' END
                FROM generate_series(1, ?) g""", cases, cases, claims);
        db.execute("""
                INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at, answered_at)
                SELECT gen_random_uuid(), ?, ('00000000-0000-0000-0003-' || lpad((1001 + g % 1000)::text, 12, '0'))::uuid,
                       '+573001112233', CASE WHEN g <= 500 THEN 'open' ELSE 'confirmed' END,
                       timestamptz '2026-09-01' + g * interval '1 minute',
                       timestamptz '2026-09-01' + g * interval '1 minute',
                       CASE WHEN g <= 500 THEN NULL ELSE timestamptz '2026-09-01' + g * interval '1 minute' + interval '1 hour' END
                FROM generate_series(1, ?) g""", heavyCase, heavyClaims);
        db.execute("ANALYZE scuby.person");
        db.execute("ANALYZE scuby.recovery_claim");
    }

    /**
     * {@code people} owners (…0004-…) and {@code pets} pets (…0005-…), pet g owned by person 1 + g % people; one link in
     * 20 has ended (active_to set). No cases. Then ANALYZE.
     */
    static void petsOwnedBy(DSLContext db, int people, int pets) {
        db.execute("""
                INSERT INTO scuby.person (id, display_name, email, created_at)
                SELECT ('00000000-0000-0000-0004-' || lpad(g::text, 12, '0'))::uuid, 'O' || g, 'o' || g || '@seed.co', now()
                FROM generate_series(1, ?) g""", people);
        db.execute("""
                INSERT INTO scuby.pet (id, name, species, custody_state, created_at)
                SELECT ('00000000-0000-0000-0005-' || lpad(g::text, 12, '0'))::uuid, 'P' || g, 'dog', 'claimed',
                       timestamptz '2026-01-01' + g * interval '1 hour'
                FROM generate_series(1, ?) g""", pets);
        db.execute("""
                INSERT INTO scuby.responsibility_link (id, person_id, pet_id, role, active_from, active_to)
                SELECT gen_random_uuid(), ('00000000-0000-0000-0004-' || lpad((1 + g % ?)::text, 12, '0'))::uuid,
                       ('00000000-0000-0000-0005-' || lpad(g::text, 12, '0'))::uuid, 'owner', timestamptz '2026-01-01',
                       CASE WHEN g % 20 = 0 THEN timestamptz '2026-06-01' END
                FROM generate_series(1, ?) g""", people, pets);
        db.execute("ANALYZE scuby.person");
        db.execute("ANALYZE scuby.pet");
        db.execute("ANALYZE scuby.responsibility_link");
    }
}
