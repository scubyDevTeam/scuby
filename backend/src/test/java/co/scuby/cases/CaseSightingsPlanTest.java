package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A case's sightings (decision 64 caps the page at 200; decision 68 indexes it). One case holds 20,000 sightings, the
 * others a handful: the capped list must be a top-N read through (case_code, seen_at DESC, id DESC), never a Sort of
 * all the case's rows, and the feed's per-case count must not scan the table.
 */
@IntegrationTest
class CaseSightingsPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired LostCaseQueries queries;
    @Autowired FeedQueries feed;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void aCasesSightingsAreReadNewestFirstThroughTheCaseRecentIndex() {
        seed();
        for (Access access : Access.values()) {
            var q = queries.sightingsQuery("C000A", access);
            PlanAssert.assertNoSeqScan(db, q, "sighting");
            PlanAssert.assertUsesIndex(db, q, "sighting_by_case_recent_idx");
            assertThat(PlanAssert.plan(db, q)).as("a Sort over all the case's sightings").doesNotContain("Sort");
        }
    }

    @Test
    void theFeedsSightingCountsDoNotScanTheTable() {
        seed();
        var q = feed.nationalQuery(null, 100, null, co.scuby.support.MutableClock.START);
        PlanAssert.assertNoSeqScan(db, q, "sighting");
        PlanAssert.assertUsesIndex(db, q, "sighting_by_case_recent_idx");
    }

    /** C000A is active (so the feed shows it) and gets 20,000 sightings; 2,000 cases share another 2,000. */
    private void seed() {
        SeedVolume.casesAndSightings(db, 2_000, 2_000);
        db.execute("""
                INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_device_hash, status)
                SELECT gen_random_uuid(), 'C000A', 6.25, -75.59, timestamptz '2026-06-01' + g * interval '1 minute',
                  timestamptz '2026-06-01' + g * interval '1 minute', md5((g % 3000)::text) || md5('d'),
                  CASE WHEN g % 10 = 0 THEN 'hidden_by_owner' ELSE 'visible' END
                FROM generate_series(1, 20000) g""");
        db.execute("ANALYZE scuby.sighting");
    }
}
