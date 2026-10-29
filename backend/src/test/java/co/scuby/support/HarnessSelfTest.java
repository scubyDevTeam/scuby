package co.scuby.support;

import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
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

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

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
        PlanAssert.assertNoSeqScanOn(db, indexed, "outbox_events");
        var unindexed = db.selectFrom(OUTBOX_EVENTS).where(OUTBOX_EVENTS.ATTEMPTS.eq(3));
        assertThatThrownBy(() -> PlanAssert.assertNoSeqScanOn(db, unindexed, "outbox_events"))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("Seq Scan on outbox_events");
    }
}
