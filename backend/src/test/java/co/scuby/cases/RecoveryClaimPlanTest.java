package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;


/**
 * The owner's claim list (spec §4.13): newest 50 of every status plus the open non-stale count, on every owner view of
 * a case. 2,000 cases share 60,000 claims (30 each) and C000A has 2,000 more. It must be read through
 * (case_code, created_at DESC) for a heavy case, never by scanning every claim of every case. The unique index
 * recovery_claim_one_per_claimant also leads with case_code, so a light case may use it; the heavy case needs the sorted index. The production query
 * (LostCaseQueries.claimsQuery) is the one checked.
 */
@IntegrationTest
class RecoveryClaimPlanTest {

    @Autowired DSLContext db;
    @Autowired LostCaseQueries queries;

    @BeforeEach
    void setUp() {
        SeedVolume.casesAndSightings(db, 2_000, 0);
        SeedVolume.claims(db, 2_000, 60_000, "C000A", 2_000);
    }

    @Test
    void anOwnersClaimListOfAHeavyCaseIsReadThroughTheCaseRecentIndex() {
        var q = queries.claimsQuery("C000A", MutableClock.START);
        PlanAssert.assertUsesIndex(db, q, "recovery_claim_by_case_recent_idx");
        PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
    }

    /** A light case has ~30 claims: the planner may read them through the unique (case, claimant) index and sort them; never a seq scan. */
    @Test
    void anOwnersClaimListOfALightCaseNeverScansTheTable() {
        var q = queries.claimsQuery("C0001", MutableClock.START);
        PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
        assertThat(PlanAssert.plan(db, q)).containsAnyOf(" using recovery_claim_by_case_recent_idx ", "Index Scan on recovery_claim_one_per_claimant",
                "Bitmap Index Scan on recovery_claim_one_per_claimant");
    }
}
