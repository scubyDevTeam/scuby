package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

/** The active_case_exists check (design · Queries and indexes). */
@IntegrationTest
class ActiveCasePlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired PublishLostService service;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void theActiveCaseLookupDoesNotScanEveryCase() {
        db.execute("INSERT INTO scuby.person (id, display_name, email, created_at) VALUES ('00000000-0000-0000-0000-000000000001', 'Seed', 'seed@x.co', now())");
        db.execute("""
                INSERT INTO scuby.pet (id, name, species, custody_state, created_at)
                SELECT ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'P' || g, 'dog', 'claimed', now()
                FROM generate_series(1, 20000) g""");
        db.execute("""
                INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, contact_phone, contact_phone_verified, phone_has_whatsapp,
                  expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_radius_m, last_seen_at)
                SELECT upper(substr(md5(g::text), 1, 5)), ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid,
                  '00000000-0000-0000-0000-000000000001', CASE WHEN g % 10 = 0 THEN 'active' ELSE 'expired' END,
                  timestamptz '2026-01-01' + g * interval '10 minutes', '+573007152284', true, true, true, false, false,
                  6.2 + (g % 100) * 0.001, -75.6 + (g % 77) * 0.001, 300, timestamptz '2026-01-01' + g * interval '10 minutes'
                FROM generate_series(1, 20000) g
                ON CONFLICT DO NOTHING""");
        db.execute("ANALYZE scuby.lost_case");
        PlanAssert.assertNoSeqScan(db, service.activeCaseQuery(UUID.fromString("00000000-0000-0000-0001-000000000010")), "lost_case");
    }
}
