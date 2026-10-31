package co.scuby.identity;

import org.jooq.DSLContext;
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
 * The send log of both code channels. The caps count it over a rolling 24 h; the table is bounded by the
 * 30-day purge, so it carries no performance index (backend/CLAUDE.md · Migrations and indexes).
 * The count and the insert that follows it are separate statements under READ COMMITTED: requests racing
 * for one target can each see a count under the cap, so a cap may be overshot by up to the number of
 * simultaneous requests for that target. Accepted (decision 59, docs/eng/backend.md · Concurrency).
 */
@Component
class CodeSends {

    enum Channel { email, sms }

    /**
     * Sends in the last 24 h: to one target, and all of the channel (the SMS spend alarm); and when the
     * target was last sent to (null if not in the window).
     */
    record Counts(int target, int all, @Nullable Instant lastToTarget) {}

    private final DSLContext db;
    private final Clock clock;

    CodeSends(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    Counts last24h(Channel channel, String target) {
        Record3<Integer, Integer, OffsetDateTime> r = countsQuery(channel, target, clock.instant().minus(Duration.ofHours(24))).fetchOne();
        return new Counts(r.value1(), r.value2(), r.value3() == null ? null : r.value3().toInstant());
    }

    void record(Channel channel, String target, @Nullable UUID personId) {
        db.insertInto(CODE_SEND)
          .set(CODE_SEND.CHANNEL, channel.name()).set(CODE_SEND.TARGET, target).set(CODE_SEND.PERSON_ID, personId)
          .set(CODE_SEND.SENT_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .execute();
    }

    /** One pass over one channel's last 24 h: sends to this target, all sends, and the target's latest send. */
    Select<Record3<Integer, Integer, OffsetDateTime>> countsQuery(Channel channel, String target, Instant since) {
        return db.select(DSL.count().filterWhere(CODE_SEND.TARGET.eq(target)), DSL.count(),
                         DSL.max(CODE_SEND.SENT_AT).filterWhere(CODE_SEND.TARGET.eq(target)))
                 .from(CODE_SEND)
                 .where(CODE_SEND.CHANNEL.eq(DSL.inline(channel.name())))
                 .and(CODE_SEND.SENT_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }

    int purgeOlderThan(Duration age) {
        OffsetDateTime cutoff = clock.instant().minus(age).atOffset(ZoneOffset.UTC);
        return db.deleteFrom(CODE_SEND).where(CODE_SEND.SENT_AT.lt(cutoff)).execute();
    }
}
