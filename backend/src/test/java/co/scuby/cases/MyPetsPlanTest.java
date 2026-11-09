package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;


/**
 * GET /me/pets (spec §4.11) runs on every publish pet picker and every «Mis mascotas» view. 20,000 pets of 1,000 owners:
 * a person's links must be found by person, not by scanning every link (responsibility_link_one_active_owner leads with
 * pet_id and cannot serve a lookup by person).
 * The production query (MyPetsQueries.query) is the one checked.
 */
@IntegrationTest
class MyPetsPlanTest {

    static final UUID OWNER_7 = UUID.fromString("00000000-0000-0000-0004-000000000007");

    @Autowired DSLContext db;
    @Autowired MyPetsQueries queries;

    @BeforeEach
    void setUp() {
        SeedVolume.petsOwnedBy(db, 1_000, 20_000);
    }

    @Test
    void aPersonsPetsAreFoundThroughTheActiveByPersonIndex() {
        var q = queries.query(OWNER_7, MutableClock.START);
        PlanAssert.assertUsesIndex(db, q, "responsibility_link_by_person_active_idx");
        PlanAssert.assertNoSeqScan(db, q, "responsibility_link");
    }
}
