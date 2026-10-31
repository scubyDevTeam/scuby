package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** A case's sightings (design · Queries and indexes): served by the replay key's unique index (case_code, client_id). */
@IntegrationTest
class CaseSightingsPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired LostCaseQueries queries;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void aCasesSightingsAreReadByIndex() {
        SeedVolume.casesAndSightings(db, 2_000, 20_000);
        for (Access access : Access.values()) {
            PlanAssert.assertNoSeqScan(db, queries.sightingsQuery("C000A", access), "sighting");
            PlanAssert.assertUsesIndex(db, queries.sightingsQuery("C000A", access), "sighting_replay_key");
        }
    }
}
