package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;



/**
 * The owner's claim list (spec §4.13): newest 50 of every status plus the open non-stale count, on every owner view of
 * a case. 2,000 cases share 60,000 claims (30 each) and C000A has 2,000 more. It must be read through
 * (case_code, created_at DESC), never by scanning every claim of every case. The partial unique index
 * recovery_claim_one_open_per_claimant cannot serve it: the list reads every status. The production query
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
    void anOwnersClaimListIsReadThroughTheCaseRecentIndex() {
        for (String code : new String[] {"C000A", "C0001"}) {
            var q = queries.claimsQuery(code, MutableClock.START);
            PlanAssert.assertUsesIndex(db, q, "recovery_claim_by_case_recent_idx");
            PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
        }
    }
}
