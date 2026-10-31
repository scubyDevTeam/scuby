package co.scuby.uploads;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;

/** The slot rate-limit count (a rate-limit count: design · Queries and indexes). */
@IntegrationTest
class UploadSlotPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired UploadSlots slots;

    @BeforeEach
    void setUp() { testDb.reset(); }

    private void seed() {
        db.execute("""
                INSERT INTO scuby.upload (owner_key, sha256, purpose, bytes, created_at, ip_hash)
                SELECT 'd:' || md5((g % 3000)::text) || md5('k'), md5(g::text) || md5(g::text), 'sighting', 1000,
                       timestamptz '2026-01-01' + g * interval '1 minute', md5((g % 2000)::text) || md5('ip')
                FROM generate_series(1, 30000) g""");
        // in-window rows for the probed keys, so the plan is chosen for a key that has something to count
        db.execute("""
                INSERT INTO scuby.upload (owner_key, sha256, purpose, bytes, created_at, ip_hash)
                SELECT 'd:' || repeat('a', 64), md5('w' || g) || md5('w' || g), 'sighting', 1000,
                       timestamptz '2026-10-14 16:55:00+00' + g * interval '1 second', repeat('b', 64)
                FROM generate_series(1, 5) g""");
        db.execute("ANALYZE scuby.upload");
    }

    /** The per-caller count and the per-IP count in one statement: neither side may scan the table. */
    @Test
    void theSlotCountsUseThePrimaryKeyPrefixAndTheIpIndex() {
        seed();
        var query = slots.recentSlotsQuery("d:" + "a".repeat(64), "b".repeat(64), Instant.parse("2026-10-14T16:50:00Z"));
        PlanAssert.assertNoSeqScan(db, query, "upload");
        PlanAssert.assertUsesIndex(db, query, "upload_pkey");
        PlanAssert.assertUsesIndex(db, query, "upload_by_ip_recent_idx");
    }
}
