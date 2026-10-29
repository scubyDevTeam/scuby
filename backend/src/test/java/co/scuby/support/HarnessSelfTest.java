package co.scuby.support;

import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.time.Clock;
import java.time.Duration;

import static co.scuby.db.generated.Tables.OUTBOX_EVENTS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class HarnessSelfTest {

    @Autowired TestDb testDb;
    @Autowired ApiClients clients;
    @Autowired StatementRecorder recorder;
    @Autowired MutableClock mutableClock;
    @Autowired Clock clock;
    @Autowired DSLContext db;
    @Autowired ConnectionSampler sampler;

    @Test
    void theAppClockIsTheMutableOne() {
        assertThat(clock.instant()).isEqualTo(MutableClock.START);
        mutableClock.advance(Duration.ofHours(1));
        assertThat(clock.instant()).isEqualTo(MutableClock.START.plus(Duration.ofHours(1)));
        testDb.reset();
        assertThat(clock.instant()).isEqualTo(MutableClock.START);
    }

    @Test
    void everyJooqStatementIsRecorded() {
        recorder.reset();
        db.selectOne().fetch();
        db.selectOne().fetch();
        assertThat(recorder.statements()).hasSize(2);
    }

    @Test
    void theRecorderSeesWhetherAStatementRanInsideATransaction() {
        recorder.reset();
        db.selectOne().fetch();
        db.transaction(tx -> tx.dsl().selectOne().fetch());
        assertThat(recorder.autoCommits()).containsExactly(true, false);
    }

    @Test
    void anEndpointWithoutACeilingFailsTheTest() {
        ApiClient api = clients.newBrowser();
        assertThatThrownBy(() -> api.call(HttpMethod.GET, "/no-such-contract-path", null))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("no statement ceiling");
    }

    @Test
    void rawCallsSkipTheChecks() {
        ApiResponse r = clients.newBrowser().raw(HttpMethod.GET, "/actuator/health", null);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/status")).isEqualTo("UP");
    }

    @Test
    void resetEmptiesTheMutableTables() {
        db.execute("INSERT INTO scuby.outbox_events (id, payload_json) VALUES (gen_random_uuid(), '{}')");
        testDb.reset();
        assertThat(db.fetchCount(OUTBOX_EVENTS)).isZero();
    }

    @Test
    void planAssertSeesAnIndexScanAndCatchesASeqScan() {
        db.execute("""
                INSERT INTO scuby.outbox_events (id, created_at, payload_json)
                SELECT gen_random_uuid(), timestamptz '2026-01-01' + g * interval '1 minute', '{}'
                FROM generate_series(1, 20000) g""");
        db.execute("ANALYZE scuby.outbox_events");
        var indexed = db.selectFrom(OUTBOX_EVENTS)
                        .where(OUTBOX_EVENTS.CREATED_AT.gt(DSL.currentOffsetDateTime()));
        PlanAssert.assertNoSeqScan(db, indexed, "outbox_events");
        var unindexed = db.selectFrom(OUTBOX_EVENTS).where(OUTBOX_EVENTS.ATTEMPTS.eq(3));
        assertThatThrownBy(() -> PlanAssert.assertNoSeqScan(db, unindexed, "outbox_events"))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("Seq Scan on outbox_events");
    }

    @Test
    void planAssertFailsOnAMisspelledTableInsteadOfPassingVacuously() {
        var q = db.selectFrom(OUTBOX_EVENTS).where(OUTBOX_EVENTS.ATTEMPTS.eq(3));
        assertThatThrownBy(() -> PlanAssert.assertNoSeqScan(db, q, "outbox_evnts"))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("outbox_evnts");
    }

    @Test
    void assertUsesIndexAcceptsTheIndexAndRejectsAnotherOne() {
        db.execute("""
                INSERT INTO scuby.outbox_events (id, created_at, payload_json)
                SELECT gen_random_uuid(), timestamptz '2026-01-01' + g * interval '1 minute', '{}'
                FROM generate_series(1, 20000) g""");
        db.execute("ANALYZE scuby.outbox_events");
        var q = db.selectFrom(OUTBOX_EVENTS).where(OUTBOX_EVENTS.CREATED_AT.gt(DSL.currentOffsetDateTime()));
        PlanAssert.assertUsesIndex(db, q, "outbox_events_created_at_idx");
        assertThatThrownBy(() -> PlanAssert.assertUsesIndex(db, q, "no_such_idx"))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("no_such_idx");
    }

    @Test
    void aResponseOutsideTheContractFailsTheCall() {
        ApiClient api = clients.newBrowser();
        assertThatThrownBy(() -> api.call(HttpMethod.GET, "/actuator/health", null))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("breaks the contract");
    }

    @Test
    void exceedingTheStatementCeilingFailsTheCallAndNamesTheCeiling() {
        ApiClient api = clients.newBrowser();
        api.callChecked(HttpMethod.POST, "/auth/sign-out", 3, "/harness-probe/statements?n=3", null);
        assertThatThrownBy(() -> api.callChecked(HttpMethod.POST, "/auth/sign-out", 2, "/harness-probe/statements?n=3", null))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("executed 3 statements (ceiling 2)");
    }

    @Test
    void anEmptyNoContentAnswerPassesAndOneWithABodyFails() {
        ApiClient api = clients.newBrowser();
        assertThat(api.callChecked(HttpMethod.POST, "/auth/sign-out", 0, "/harness-probe/no-content", null).status()).isEqualTo(204);
        assertThatThrownBy(() -> api.callChecked(HttpMethod.POST, "/auth/sign-out", 0, "/harness-probe/no-content-with-body", null))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("breaks the contract");
    }

    @Test
    void aRequestAnsweredByAFilterDoesNotReturnThePreviousCallsConnectionSample() {
        ApiClient api = clients.newBrowser();
        api.raw(HttpMethod.GET, "/harness-probe/ok", null);
        assertThat(sampler.activeWhenTheHandlerStarted()).isPresent();
        ApiResponse refused = api.raw(HttpMethod.GET, "/harness-probe/secured", null);
        assertThat(refused.status()).isEqualTo(401);
        assertThat(sampler.activeWhenTheHandlerStarted()).isEmpty();
    }

    @Test
    void onlyTheRequestThreadsStatementsAreCounted() throws InterruptedException {
        ApiClient api = clients.newBrowser();
        Thread other = new Thread(() -> { for (int i = 0; i < 5; i++) db.selectOne().fetch(); });
        other.start();
        other.join();
        ApiResponse r = api.callChecked(HttpMethod.POST, "/auth/sign-out", 0, "/harness-probe/no-content", null);
        assertThat(r.statements()).isEmpty();
        recorder.reset();
        other = new Thread(() -> db.selectOne().fetch());
        other.start();
        other.join();
        db.selectOne().fetch();
        assertThat(recorder.statementsOnCurrentThread()).hasSize(1);
        assertThat(recorder.statements()).hasSize(2);
    }
}
