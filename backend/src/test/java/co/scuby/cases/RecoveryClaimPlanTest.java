package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.ZoneOffset;

import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;

/**
 * The owner's claim list (spec §4.13): newest 50 of every status plus the open non-stale count, on every owner view of
 * a case. 2,000 cases share 60,000 claims (30 each) and C000A has 2,000 more. It must be read through
 * (case_code, created_at DESC), never by scanning every claim of every case. The partial unique index
 * recovery_claim_one_open_per_claimant cannot serve it: the list reads every status.
 */
@IntegrationTest
class RecoveryClaimPlanTest {

    @Autowired DSLContext db;

    @BeforeEach
    void setUp() {
        SeedVolume.casesAndSightings(db, 2_000, 0);
        SeedVolume.claims(db, 2_000, 60_000, "C000A", 2_000);
    }

    @Test
    void anOwnersClaimListIsReadThroughTheCaseRecentIndex() {
        for (String code : new String[] {"C000A", "C0001"}) {
            var q = ownerClaimList(code);
            PlanAssert.assertUsesIndex(db, q, "recovery_claim_by_case_recent_idx");
            PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
        }
    }

    /** The query exactly as spec §4.13 writes it. Task 10 replaces this method with LostCaseQueries.claimsQuery. */
    private Select<?> ownerClaimList(String code) {
        var cutoff = MutableClock.START.minus(Duration.ofDays(7)).atOffset(ZoneOffset.UTC);
        return db.select(RECOVERY_CLAIM.ID, RECOVERY_CLAIM.PHONE, RECOVERY_CLAIM.CREATED_AT, RECOVERY_CLAIM.STATUS,
                         DSL.count().filterWhere(RECOVERY_CLAIM.STATUS.eq(DSL.inline("open"))
                                 .and(RECOVERY_CLAIM.LAST_ACTIVE_AT.ge(cutoff))).over().as("open_non_stale"))
                 .from(RECOVERY_CLAIM)
                 .where(RECOVERY_CLAIM.CASE_CODE.eq(code))
                 .orderBy(RECOVERY_CLAIM.CREATED_AT.desc(), RECOVERY_CLAIM.ID.desc())
                 .limit(50);
    }
}
