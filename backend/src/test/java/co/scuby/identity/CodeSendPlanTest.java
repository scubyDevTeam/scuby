package co.scuby.identity;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

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
        // 30 days of retention, 30,000 rows (one per 86.4 s, both channels), the newest a few hours past `since`:
        // the 24 h window holds a small, non-empty slice of the table, as in production.
        Instant since = Instant.parse("2026-10-13T17:00:00Z");
        db.execute("""
                INSERT INTO scuby.code_send (channel, target, device_hash, ip_hash, sent_at)
                SELECT CASE WHEN g % 2 = 0 THEN 'sms' ELSE 'email' END,
                       '+57300' || lpad(g::text, 7, '0'), md5(g::text) || md5(g::text), md5((g % 500)::text) || md5('x'),
                       ?::timestamptz + interval '3 hours' - g * interval '86.4 seconds'
                FROM generate_series(1, 30000) g""", since.toString());
        db.execute("ANALYZE scuby.code_send");
        var query = sends.throttleQuery(CodeSends.Channel.sms, "+573007152284", java.util.UUID.randomUUID(), "d", "i", since);
        int inWindow = db.fetchOne("SELECT count(*) FROM scuby.code_send WHERE channel = 'sms' AND sent_at > ?::timestamptz",
                since.toString()).get(0, Integer.class);
        assertThat(inWindow).as("rows of the channel inside the window").isBetween(20, 300);
        PlanAssert.assertNoSeqScan(db, query, "code_send");
        PlanAssert.assertUsesIndex(db, query, "code_send_channel_sent_at_idx");
    }
}
