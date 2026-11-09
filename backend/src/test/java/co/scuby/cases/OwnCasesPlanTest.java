package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

/** A person's cases (GET /me/cases): must not read every case of every publisher. */
@IntegrationTest
class OwnCasesPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired MyCasesQueries queries;

    @BeforeEach
    void setUp() {
        testDb.reset();
        SeedVolume.casesAndSightings(db, 20_000, 1_000);
        // SeedVolume gives every case one publisher; spread them over 1,000 people (about 20 cases each).
        db.execute("""
                INSERT INTO scuby.person (id, display_name, email, created_at)
                SELECT ('00000000-0000-0000-0002-' || lpad(g::text, 12, '0'))::uuid, 'P' || g, 'p' || g || '@seed.co', now()
                FROM generate_series(1, 1000) g""");
        db.execute("""
                UPDATE scuby.lost_case
                SET created_by = ('00000000-0000-0000-0002-' || lpad((1 + abs(hashtext(code)) % 1000)::text, 12, '0'))::uuid""");
        db.execute("ANALYZE scuby.lost_case");
    }

    @Test
    void aPersonsCasesAreReadByIndex() {
        var q = queries.query(UUID.fromString("00000000-0000-0000-0002-000000000007"), co.scuby.support.MutableClock.START);
        PlanAssert.assertUsesIndex(db, q, "lost_case_by_publisher_idx");
        PlanAssert.assertNoSeqScan(db, q, "lost_case");
        PlanAssert.assertNoSeqScan(db, q, "pet");
    }
}
