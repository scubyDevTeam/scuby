package co.scuby.identity;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;

/** Growth-sensitive query (design · Queries and indexes): the code-send throttle counts of both channels. */
@IntegrationTest
class CodeSendPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired CodeSends sends;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void theThrottleCountReadsOnlyTheLastDayOfOneChannel() {
        db.execute("""
                INSERT INTO scuby.code_send (channel, target, device_hash, ip_hash, sent_at)
                SELECT CASE WHEN g % 2 = 0 THEN 'sms' ELSE 'email' END,
                       '+57300' || lpad(g::text, 7, '0'), md5(g::text) || md5(g::text), md5((g % 500)::text) || md5('x'),
                       timestamptz '2026-01-01' + g * interval '10 minutes'
                FROM generate_series(1, 30000) g""");
        db.execute("ANALYZE scuby.code_send");
        var query = sends.throttleQuery(CodeSends.Channel.sms, "+573007152284", "d", "i", Instant.parse("2026-10-13T17:00:00Z"));
        PlanAssert.assertNoSeqScan(db, query, "code_send");
        PlanAssert.assertUsesIndex(db, query, "code_send_channel_sent_at_idx");
    }
}
