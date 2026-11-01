package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The correlated open-claim counts of the publisher's feed items and of «Mis casos» (spec §4.13) must not scan every claim:
 * they go through recovery_claim_by_case_recent_idx or the partial recovery_claim_one_open_per_claimant (both lead with
 * case_code; which one the planner picks is its call). 2,000 cases of one seed publisher, 62,000 claims.
 */
@IntegrationTest
class ClaimCountPlanTest {

    static final UUID SEED_PUBLISHER = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Autowired DSLContext db;
    @Autowired FeedQueries feed;
    @Autowired MyCasesQueries myCases;

    @BeforeEach
    void setUp() {
        SeedVolume.casesAndSightings(db, 2_000, 2_000);
        SeedVolume.claims(db, 2_000, 60_000, "C000A", 2_000);
    }

    @Test
    void thePublishersFeedBadgeDoesNotScanTheClaims() {
        var q = feed.nationalQuery(null, 100, SEED_PUBLISHER, MutableClock.START);
        PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
        assertReadThroughAClaimIndex(q);
    }

    @Test
    void misCasosCountsDoNotScanTheClaims() {
        var q = myCases.query(SEED_PUBLISHER, MutableClock.START);
        PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
        assertReadThroughAClaimIndex(q);
    }

    /** By index name, as the plan checks require: either of the two indexes leading with case_code. */
    private void assertReadThroughAClaimIndex(org.jooq.Query q) {
        assertThat(PlanAssert.plan(db, q)).containsAnyOf(" using recovery_claim_by_case_recent_idx ",
                " using recovery_claim_one_open_per_claimant ", "Bitmap Index Scan on recovery_claim_");
        // Correlated on the case: every index scan of recovery_claim is followed by an Index Cond on case_code. A hashed
        // subplan (all open claims read once) has none. Scoped to the recovery_claim node lines: the feed's sighting
        // subplans print the same Index Cond text, and plain EXPLAIN never prints "hashed SubPlan" for a CASE branch.
        var lines = PlanAssert.plan(db, q).lines().toList();
        int scans = 0;
        for (int i = 0; i < lines.size(); i++) {
            if (!lines.get(i).contains("Scan") || !lines.get(i).contains("recovery_claim_")) continue;
            scans++;
            assertThat(i + 1 < lines.size() ? lines.get(i + 1) : "").as("Index Cond under: " + lines.get(i))
                    .contains("Index Cond: (case_code = lost_case.code)");
        }
        assertThat(scans).as("recovery_claim index scans in the plan").isPositive();
    }
}
