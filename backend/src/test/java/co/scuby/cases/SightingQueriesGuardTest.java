package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Caller;
import co.scuby.support.Accounts;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.BiPredicate;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * The correction's and the delete's own UPDATE guards, exercised directly: the service's Java pre-read refuses a pin
 * outside the window, or not the caller's, before the UPDATE is ever sent, so only these tests reach the SQL clauses
 * (the window and "mine"). Same idea as CaseLifecycleTest's direct reopen window test.
 */
@IntegrationTest
class SightingQueriesGuardTest {

    static final Instant CREATED = MutableClock.START.minus(Duration.ofMinutes(5));
    static final Duration WINDOW = Duration.ofMinutes(15);
    static final String DEVICE = "d".repeat(64);
    static final String OTHER_DEVICE = "e".repeat(64);
    static final GeoPoint MOVED = new GeoPoint(6.25, -75.59);
    static final Instant SEEN = CREATED.minusSeconds(60);

    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired SightingQueries queries;

    UUID carolina;
    UUID andres;

    /** The two operations under test, as (pin, caller, now) -> did the UPDATE touch the row. */
    interface Op {
        boolean apply(UUID pin, Caller caller, Instant now);
    }

    final Op correct = (pin, caller, now) -> queries.correct("7K3PQ", pin, caller, MOVED, SEEN, "movida", now);
    final Op delete = (pin, caller, now) -> queries.deleteOwn("7K3PQ", pin, caller, now);

    @BeforeEach
    void setUp() {
        carolina = accounts.person("carolina@correo.co");
        andres = accounts.person("andres@correo.co");
        cases.luna(carolina);
    }

    private UUID anonymousPin() {
        return cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, null, DEVICE, null, "visible");
    }

    private boolean untouched(UUID pin) {
        var r = db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(pin)).fetchOne();
        return r.getStatus().equals("visible") && r.getLat() == CaseFixtures.MEDELLIN.lat() && r.getNote() == null;
    }

    private void windowEdge(Op op, BiPredicate<UUID, Boolean> afterwards) {
        UUID atEdge = anonymousPin();
        assertThat(op.apply(atEdge, new Caller(null, DEVICE), CREATED.plus(WINDOW))).as("exactly 15 minutes").isFalse();
        assertThat(untouched(atEdge)).isTrue();
        UUID justInside = anonymousPin();
        assertThat(op.apply(justInside, new Caller(null, DEVICE), CREATED.plus(WINDOW).minusMillis(1))).as("15 minutes minus 1 ms").isTrue();
        assertThat(afterwards.test(justInside, true)).isTrue();
    }

    @Test
    void theCorrectionsWindowClauseIsExclusiveAtFifteenMinutes() {
        windowEdge(correct, (pin, ok) -> db.fetchValue(SIGHTING.NOTE, SIGHTING.ID.eq(pin)).equals("movida"));
    }

    @Test
    void theDeletesWindowClauseIsExclusiveAtFifteenMinutes() {
        windowEdge(delete, (pin, ok) -> db.fetchValue(SIGHTING.STATUS, SIGHTING.ID.eq(pin)).equals("deleted_by_reporter"));
    }

    private void anotherPersonsPinIsNeverMine(Op op) {
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, DEVICE, null, "visible");
        // same device hash, but the pin has another person: not mine, signed in as someone else or not signed in
        assertThat(op.apply(theirs, new Caller(carolina, DEVICE), CREATED.plusSeconds(1))).isFalse();
        assertThat(op.apply(theirs, new Caller(null, DEVICE), CREATED.plusSeconds(1))).isFalse();
        assertThat(untouched(theirs)).isTrue();
        assertThat(op.apply(theirs, new Caller(andres, OTHER_DEVICE), CREATED.plusSeconds(1))).as("their own account, any device").isTrue();
    }

    @Test
    void theCorrectionsMineClauseRefusesAnotherPersonsPinEvenFromTheSameDevice() {
        anotherPersonsPinIsNeverMine(correct);
    }

    @Test
    void theDeletesMineClauseRefusesAnotherPersonsPinEvenFromTheSameDevice() {
        anotherPersonsPinIsNeverMine(delete);
    }

    private void anAnonymousPinFromAnotherDeviceIsNotMine(Op op) {
        UUID pin = anonymousPin();
        assertThat(op.apply(pin, new Caller(null, OTHER_DEVICE), CREATED.plusSeconds(1))).isFalse();
        assertThat(op.apply(pin, new Caller(carolina, OTHER_DEVICE), CREATED.plusSeconds(1))).isFalse();
        assertThat(untouched(pin)).isTrue();
        assertThat(op.apply(pin, new Caller(carolina, DEVICE), CREATED.plusSeconds(1))).as("an anonymous pin from my device").isTrue();
    }

    @Test
    void theCorrectionsMineClauseRefusesAnAnonymousPinFromAnotherDevice() {
        anAnonymousPinFromAnotherDeviceIsNotMine(correct);
    }

    @Test
    void theDeletesMineClauseRefusesAnAnonymousPinFromAnotherDevice() {
        anAnonymousPinFromAnotherDeviceIsNotMine(delete);
    }

    @Test
    void theCorrectionsOwnGuardRefusesAClosedCase() {
        UUID pin = anonymousPin();
        cases.close("7K3PQ", "reunited", CREATED.plusSeconds(30));
        assertThat(correct.apply(pin, new Caller(null, DEVICE), CREATED.plusSeconds(60))).isFalse();
        assertThat(untouched(pin)).isTrue();
    }
}
