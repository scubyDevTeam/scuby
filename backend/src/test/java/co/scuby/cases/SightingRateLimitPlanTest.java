package co.scuby.cases;

import co.scuby.platform.security.Caller;
import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.UUID;

/** The «Lo vi» rate-limit counts (design · Queries and indexes): per account, per device, per IP. */
@IntegrationTest
class SightingRateLimitPlanTest {

    static final Instant SINCE = Instant.parse("2026-10-13T17:00:00Z");
    static final UUID PERSON = UUID.fromString("00000000-0000-0000-0000-000000000001");
    static final String DEVICE = "a".repeat(64);
    static final String IP = "b".repeat(64);

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired SightingQueries queries;

    /**
     * A day that looks like traffic: 40,000 old rows, 6,000 more from other reporters inside the 24 h window (so a
     * created_at-only index would still read thousands of rows), and for each probed key thousands of old rows plus a
     * handful inside the window (the rows a count really has to read). Then ANALYZE.
     */
    @BeforeEach
    void setUp() {
        testDb.reset();
        SeedVolume.casesAndSightings(db, 2_000, 40_000);
        db.execute("""
                INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_device_hash, reporter_ip_hash, status)
                SELECT gen_random_uuid(), 'C' || upper(lpad(to_hex(1 + g % 2000), 4, '0')), 6.25, -75.59, ?::timestamptz + g * interval '10 seconds',
                  ?::timestamptz + g * interval '10 seconds', md5('other-d' || (g % 900)) || md5('d'), md5('other-i' || (g % 500)) || md5('i'), 'visible'
                FROM generate_series(1, 6000) g""", SINCE.toString(), SINCE.toString());
        seedKey("reporter_person_id", "'" + PERSON + "'::uuid", "md5('p' || g) || md5('d')", "md5('p' || g) || md5('i')");
        seedKey("reporter_device_hash", "'" + DEVICE + "'", null, "md5('d' || g) || md5('i')");
        seedKey("reporter_ip_hash", "'" + IP + "'", "md5('i' || g) || md5('d')", null);
        db.execute("ANALYZE scuby.sighting");
    }

    /** 3,000 rows of the key before the window and 4 inside it; the other reporter columns carry unrelated values. */
    private void seedKey(String column, String value, String device, String ip) {
        String deviceExpr = device == null ? "md5('x' || g) || md5('d')" : device;
        String ipExpr = ip == null ? "md5('y' || g) || md5('i')" : ip;
        String keyDevice = column.equals("reporter_device_hash") ? value : deviceExpr;
        String keyIp = column.equals("reporter_ip_hash") ? value : ipExpr;
        String person = column.equals("reporter_person_id") ? value : "NULL";
        db.execute("""
                INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_person_id, reporter_device_hash, reporter_ip_hash, status)
                SELECT gen_random_uuid(), 'C' || upper(lpad(to_hex(1 + g %% 2000), 4, '0')), 6.25, -75.59, now(),
                  CASE WHEN g <= 3000 THEN timestamptz '2026-06-01' + g * interval '1 hour'
                       ELSE ?::timestamptz + (g - 3000) * interval '1 hour' END,
                  %s, %s, %s, 'visible'
                FROM generate_series(1, 3004) g""".formatted(person, keyDevice, keyIp), SINCE.toString());
    }

    @Test
    void perAccount() {
        Caller signedIn = new Caller(PERSON, DEVICE, IP);
        PlanAssert.assertUsesIndex(db, queries.reporterCountsQuery(signedIn, "C000A", SINCE), "sighting_reporter_person_recent_idx");
    }

    @Test
    void perDevice() {
        Caller anonymous = new Caller(null, DEVICE, IP);
        PlanAssert.assertUsesIndex(db, queries.reporterCountsQuery(anonymous, "C000A", SINCE), "sighting_reporter_device_recent_idx");
    }

    @Test
    void perIp() {
        PlanAssert.assertUsesIndex(db, queries.ipCountsQuery(IP, "C000A", SINCE), "sighting_reporter_ip_recent_idx");
    }
}
