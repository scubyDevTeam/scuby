package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The feed (design · Queries and indexes). Only the national branch is checked: it is the only one
 * real traffic reaches until the client sends a point (the local branch's GiST index is deferred).
 * The check is positive — "uses the index meant for it" — because the partial unique index
 * lost_case_one_active_per_pet already avoids a Seq Scan on lost_case while still reading
 * every active case; and `pet` is checked too, since a hash join can scan every pet ever.
 */
@IntegrationTest
class FeedPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired FeedQueries queries;

    @BeforeEach
    void setUp() {
        testDb.reset();
        SeedVolume.casesAndSightings(db, 20_000, 40_000);
    }

    @Test
    void theNationalFeedReadsNewestActiveCasesInIndexOrder() {
        var q = queries.nationalQuery(null, 100);
        PlanAssert.assertUsesIndex(db, q, "lost_case_active_published_idx");
        PlanAssert.assertNoSeqScan(db, q, "lost_case");
        PlanAssert.assertNoSeqScan(db, q, "pet");
        PlanAssert.assertNoSeqScan(db, q, "sighting");
    }
}
