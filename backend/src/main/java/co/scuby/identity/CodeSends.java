package co.scuby.identity;

import org.jooq.DSLContext;
import org.jooq.Record5;
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

/** The send log of both code channels: one indexed range count per check (design · Queries and indexes). */
@Component
class CodeSends {

    enum Channel { email, sms }

    record Counts(int target, int account, int device, int ip, int all) {}

    private final DSLContext db;
    private final Clock clock;

    CodeSends(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    /** {@code personId} null: no per-account count (the email channel's sends are not capped per account). */
    Counts last24h(Channel channel, String target, @Nullable UUID personId, String deviceHash, String ipHash) {
        Record5<Integer, Integer, Integer, Integer, Integer> r =
                throttleQuery(channel, target, personId, deviceHash, ipHash, clock.instant().minus(Duration.ofHours(24))).fetchOne();
        return new Counts(r.value1(), r.value2(), r.value3(), r.value4(), r.value5());
    }

    void record(Channel channel, String target, @Nullable UUID personId, String deviceHash, String ipHash) {
        db.insertInto(CODE_SEND)
          .set(CODE_SEND.CHANNEL, channel.name()).set(CODE_SEND.TARGET, target).set(CODE_SEND.PERSON_ID, personId)
          .set(CODE_SEND.DEVICE_HASH, deviceHash).set(CODE_SEND.IP_HASH, ipHash)
          .set(CODE_SEND.SENT_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .execute();
    }

    /** One pass over one channel's last 24 h: per target, per account, per device, per IP, and all (the SMS alarm). */
    Select<Record5<Integer, Integer, Integer, Integer, Integer>> throttleQuery(
            Channel channel, String target, @Nullable UUID personId, String deviceHash, String ipHash, Instant since) {
        return db.select(
                         DSL.count().filterWhere(CODE_SEND.TARGET.eq(target)),
                         DSL.count().filterWhere(personId == null ? DSL.falseCondition() : CODE_SEND.PERSON_ID.eq(personId)),
                         DSL.count().filterWhere(CODE_SEND.DEVICE_HASH.eq(deviceHash)),
                         DSL.count().filterWhere(CODE_SEND.IP_HASH.eq(ipHash)),
                         DSL.count())
                 .from(CODE_SEND)
                 .where(CODE_SEND.CHANNEL.eq(DSL.inline(channel.name())))
                 .and(CODE_SEND.SENT_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }

    /**
     * The purge names both channels so it can range-scan code_send_channel_sent_at_idx once per channel
     * (PG17 has no B-tree skip scan: a filter on sent_at alone would not use that index). This corrects the
     * migration V20261029_1035 comment, which says the index serves a sent_at-only purge; the migration is left
     * untouched to keep its checksum.
     */
    int purgeOlderThan(Duration age) {
        OffsetDateTime cutoff = clock.instant().minus(age).atOffset(ZoneOffset.UTC);
        return db.deleteFrom(CODE_SEND)
                 .where(CODE_SEND.CHANNEL.in(Channel.email.name(), Channel.sms.name()))
                 .and(CODE_SEND.SENT_AT.lt(cutoff)).execute();
    }
}
