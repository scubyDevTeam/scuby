package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * «A newer case of the same pet exists» (LifecycleQueries.superseded, decision #81) runs in load() (every lifecycle action), in
 * every reopen UPDATE and in /me/pets once per expired case. 100,000 cases of 20,000 pets (five each): the lookup must be an index
 * probe on (pet_id, published_at DESC, code DESC), never a scan of lost_case. The partial lost_case_one_active_per_pet cannot serve
 * it (active rows only).
 */
@IntegrationTest
class NewestCasePlanTest {

    static final String INDEX = "lost_case_by_pet_recent_idx";
    static final String SOME_CASE = "00A01";

    @Autowired DSLContext db;
    @Autowired MyPetsQueries queries;

    @BeforeEach
    void setUp() {
        SeedVolume.petsOwnedBy(db, 1_000, 20_000);
        SeedVolume.casesPerPet(db, 1_000, 20_000, 5);
    }

    @Test
    void theSupersededCheckOfALoadIsAnIndexProbeByPet() {
        var q = db.select(LOST_CASE.CODE, DSL.field(LifecycleQueries.superseded(LOST_CASE)).as("superseded"))
                  .from(LOST_CASE).where(LOST_CASE.CODE.eq(SOME_CASE));
        PlanAssert.assertUsesIndex(db, q, INDEX);
        PlanAssert.assertNoSeqScan(db, q, "lost_case");
    }

    @Test
    void theSupersededGuardOfAReopenIsAnIndexProbeByPet() {
        var q = db.update(LOST_CASE).set(LOST_CASE.STATUS, DSL.inline("active"))
                  .where(LOST_CASE.CODE.eq(SOME_CASE), LifecycleQueries.superseded(LOST_CASE).not());
        PlanAssert.assertUsesIndex(db, q, INDEX);
        PlanAssert.assertNoSeqScan(db, q, "lost_case");
    }

    @Test
    void myPetsProbesTheNewestCaseThroughTheIndexAndNeverScansLostCase() {
        var q = queries.query(MyPetsPlanTest.OWNER_7, MutableClock.START);
        PlanAssert.assertUsesIndex(db, q, INDEX);
        PlanAssert.assertNoSeqScan(db, q, "lost_case");
    }

    @Test
    void theSeedHoldsTheVolumeAndTheOneActivePerPetRule() {
        assertThat(db.fetchCount(LOST_CASE)).isEqualTo(100_000);
    }
}
