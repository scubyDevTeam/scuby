package co.scuby.identity;

import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record1;
import org.jooq.Record3;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.CODE_SEND;

/**
 * The log of both code channels, two kinds of row: {@code send} (a code went out) and {@code fail} (a wrong code was
 * checked against a live one). Both are counted over a rolling 24 h: sends against the per-target send caps, failures
 * against the cap of {@value #MAX_FAILURES_PER_DAY} failed checks per target, which issuing a new code never resets
 * (docs/eng/auth.md · Guessing budget). The table is bounded by the 30-day purge and indexed on (channel, target,
 * sent_at) because an attacker, not the purge, decides how many targets it holds (V20261031_0940).
 *
 * <p>The count and the insert that follows it are separate statements under READ COMMITTED: requests racing
 * for one target can each see a count under the cap, so a cap may be overshot by up to the number of
 * simultaneous requests for that target. Accepted (decision 59, docs/eng/backend.md · Concurrency). The failure cap is
 * read inside the statement that checks the code, so a capped target never consumes a code, right or wrong.
 */
@Component
class CodeSends {

    enum Channel { email, sms }

    /** At most this many failed code checks per target in a rolling 24 h. */
    static final int MAX_FAILURES_PER_DAY = 10;
    private static final Duration WINDOW = Duration.ofHours(24);
    private static final String SEND = "send";
    private static final String FAIL = "fail";

    /**
     * Sends in the last 24 h: to one target, and (only when asked for: the SMS spend alarm) all of the channel; and when
     * the target was last sent to (null if not in the window).
     */
    record Counts(int target, int all, @Nullable Instant lastToTarget) {}

    private final DSLContext db;
    private final Clock clock;

    CodeSends(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    private Instant since() {
        return clock.instant().minus(WINDOW);
    }

    /** One statement. {@code channelTotal} adds the channel-wide count (SMS only; the email path never scans a channel). */
    Counts last24h(Channel channel, String target, boolean channelTotal) {
        Record3<Integer, Integer, OffsetDateTime> r = countsQuery(channel, target, since(), channelTotal).fetchOne();
        return new Counts(r.value1(), r.value2(), r.value3() == null ? null : r.value3().toInstant());
    }

    void record(Channel channel, String target, @Nullable UUID personId) {
        insert(channel, target, personId, SEND);
    }

    /** A wrong code was checked against a live one. Autocommit-safe: one INSERT, no transaction needed. */
    void recordFailure(Channel channel, String target) {
        insert(channel, target, null, FAIL);
    }

    /** True when the target already has {@value #MAX_FAILURES_PER_DAY} failed checks in the last 24 h. */
    boolean failureCapReached(Channel channel, String target) {
        return db.fetchValue(failureCountQuery(channel, target, since())) >= MAX_FAILURES_PER_DAY;
    }

    /** For the statement that checks a code: true while the target is under the failure cap. */
    Condition failureCapOpen(Channel channel, String target) {
        return DSL.field(failureCountQuery(channel, target, since())).lt(MAX_FAILURES_PER_DAY);
    }

    private void insert(Channel channel, String target, @Nullable UUID personId, String kind) {
        db.insertInto(CODE_SEND)
          .set(CODE_SEND.CHANNEL, channel.name()).set(CODE_SEND.TARGET, target).set(CODE_SEND.PERSON_ID, personId)
          .set(CODE_SEND.KIND, kind)
          .set(CODE_SEND.SENT_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .execute();
    }

    /** The target's sends since {@code since}: count and latest (+ the channel's count for SMS). Served by the (channel, target, sent_at) index. */
    Select<Record3<Integer, Integer, OffsetDateTime>> countsQuery(Channel channel, String target, Instant since, boolean channelTotal) {
        Field<Integer> total = channelTotal
                ? DSL.field(DSL.select(DSL.count()).from(CODE_SEND)
                               .where(CODE_SEND.CHANNEL.eq(DSL.inline(channel.name())), CODE_SEND.KIND.eq(DSL.inline(SEND)),
                                      CODE_SEND.SENT_AT.gt(since.atOffset(ZoneOffset.UTC))))
                : DSL.inline(0);
        return db.select(DSL.count(), total.as("channel_total"), DSL.max(CODE_SEND.SENT_AT))
                 .from(CODE_SEND)
                 .where(CODE_SEND.CHANNEL.eq(DSL.inline(channel.name())), CODE_SEND.TARGET.eq(target),
                        CODE_SEND.KIND.eq(DSL.inline(SEND)), CODE_SEND.SENT_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }

    /** The target's failed checks since {@code since}. Served by the same index. */
    Select<Record1<Integer>> failureCountQuery(Channel channel, String target, Instant since) {
        return db.select(DSL.count())
                 .from(CODE_SEND)
                 .where(CODE_SEND.CHANNEL.eq(DSL.inline(channel.name())), CODE_SEND.TARGET.eq(target),
                        CODE_SEND.KIND.eq(DSL.inline(FAIL)), CODE_SEND.SENT_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }

    int purgeOlderThan(Duration age) {
        OffsetDateTime cutoff = clock.instant().minus(age).atOffset(ZoneOffset.UTC);
        return db.deleteFrom(CODE_SEND).where(CODE_SEND.SENT_AT.lt(cutoff)).execute();
    }
}
