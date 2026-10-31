package co.scuby.identity;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;

/**
 * The code log's per-target counts (send caps, cooldown, failed-check cap) run on every sign-in start and verify, and an
 * attacker, not the purge, decides how many targets the table holds: they must be read by index, not by scanning the
 * table (V20261031_0940, backend/CLAUDE.md · Migrations and indexes). The seeded table has 60,000 rows over 25,000 targets.
 */
@IntegrationTest
class CodeSendPlanTest {

    static final String INDEX = "code_send_channel_target_sent_at_idx";
    static final Instant SINCE = Instant.parse("2026-10-13T17:00:00Z");

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired CodeSends sends;

    @BeforeEach
    void setUp() {
        testDb.reset();
        db.execute("""
                INSERT INTO scuby.code_send (channel, target, kind, sent_at)
                SELECT CASE WHEN g % 5 = 0 THEN 'sms' ELSE 'email' END,
                       CASE WHEN g % 5 = 0 THEN '+57300' || lpad((g % 5000)::text, 7, '0') ELSE 'user' || (g % 20000) || '@correo.co' END,
                       CASE WHEN g % 7 = 0 THEN 'fail' ELSE 'send' END,
                       timestamptz '2026-09-20' + g * interval '55 seconds'
                FROM generate_series(1, 60000) g""");
        db.execute("ANALYZE scuby.code_send");
    }

    @Test
    void aTargetsSendCountIsReadByIndexForEmail() {
        var q = sends.countsQuery(CodeSends.Channel.email, "user42@correo.co", SINCE, false);
        PlanAssert.assertUsesIndex(db, q, INDEX);
        PlanAssert.assertNoSeqScan(db, q, "code_send");
    }

    @Test
    void aNumbersSendCountIsReadByIndexForSms() {
        var q = sends.countsQuery(CodeSends.Channel.sms, "+573000000042", SINCE, false);
        PlanAssert.assertUsesIndex(db, q, INDEX);
        PlanAssert.assertNoSeqScan(db, q, "code_send");
    }

    @Test
    void aTargetsFailedCheckCountIsReadByIndex() {
        for (var channel : CodeSends.Channel.values()) {
            String target = channel == CodeSends.Channel.email ? "user42@correo.co" : "+573000000042";
            var q = sends.failureCountQuery(channel, target, SINCE);
            PlanAssert.assertUsesIndex(db, q, INDEX);
            PlanAssert.assertNoSeqScan(db, q, "code_send");
        }
    }

    @Test
    void theSmsSpendAlarmReadsOnlySmsRowsByTheSameIndex() {
        var q = sends.countsQuery(CodeSends.Channel.sms, "+573000000042", SINCE, true);
        PlanAssert.assertUsesIndex(db, q, INDEX);
        PlanAssert.assertNoSeqScan(db, q, "code_send");
    }
}
