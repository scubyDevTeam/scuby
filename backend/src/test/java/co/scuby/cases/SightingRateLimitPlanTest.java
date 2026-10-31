package co.scuby.cases;

import co.scuby.platform.security.Caller;
import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.UUID;

/** The «Lo vi» rate-limit counts (design · Queries and indexes): per account, per device, per IP. */
@IntegrationTest
class SightingRateLimitPlanTest {

    static final Instant SINCE = Instant.parse("2026-10-13T17:00:00Z");

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired SightingQueries queries;

    @BeforeEach
    void setUp() {
        testDb.reset();
        SeedVolume.casesAndSightings(db, 2_000, 40_000);
    }

    @Test
    void perAccount() {
        Caller signedIn = new Caller(UUID.fromString("00000000-0000-0000-0000-000000000001"), "a".repeat(64), "b".repeat(64));
        PlanAssert.assertNoSeqScan(db, queries.reporterCountsQuery(signedIn, "C000A", SINCE), "sighting");
    }

    @Test
    void perDevice() {
        Caller anonymous = new Caller(null, "a".repeat(64), "b".repeat(64));
        PlanAssert.assertNoSeqScan(db, queries.reporterCountsQuery(anonymous, "C000A", SINCE), "sighting");
    }

    @Test
    void perIp() {
        PlanAssert.assertNoSeqScan(db, queries.ipCountsQuery("b".repeat(64), "C000A", SINCE), "sighting");
    }
}
