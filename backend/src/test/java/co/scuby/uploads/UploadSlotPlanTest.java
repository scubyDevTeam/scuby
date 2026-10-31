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

    @Test
    void theSlotCountUsesThePrimaryKeyPrefix() {
        db.execute("""
                INSERT INTO scuby.upload (owner_key, sha256, purpose, bytes, created_at)
                SELECT 'd:' || md5((g % 3000)::text) || md5('k'), md5(g::text) || md5(g::text), 'sighting', 1000,
                       timestamptz '2026-01-01' + g * interval '1 minute'
                FROM generate_series(1, 30000) g""");
        db.execute("ANALYZE scuby.upload");
        var query = slots.recentSlotsQuery("d:" + "a".repeat(64), Instant.parse("2026-10-14T16:50:00Z"));
        PlanAssert.assertNoSeqScan(db, query, "upload");
        PlanAssert.assertUsesIndex(db, query, "upload_pkey");
    }
}
