package co.scuby.identity;

import co.scuby.db.generated.tables.records.EmailCodeRecord;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import static co.scuby.db.generated.Tables.EMAIL_CODE;

/**
 * Sign-in codes (design · Behaviour decisions, Email code). Callers run these inside a transaction, and send
 * the returned {@link Outgoing} with {@link #deliver} only after it commits (no network call in a transaction).
 */
@Component
class EmailCodes {

    static final Duration TTL = Duration.ofMinutes(5);
    static final Duration COOLDOWN = Duration.ofSeconds(60);
    static final int MAX_ATTEMPTS = 3;
    /** At most this many sends per address in a rolling 24 h. */
    static final int MAX_SENDS_PER_DAY = 10;

    /** A code stored and waiting to be sent. */
    record Outgoing(String email, String code) {}

    private final DSLContext db;
    private final Clock clock;
    private final EmailSender sender;
    private final TestBypass bypass;
    private final CodeHasher hasher;
    private final CodeSends sends;

    EmailCodes(DSLContext db, Clock clock, EmailSender sender, TestBypass bypass, CodeHasher hasher,
               CodeSends sends) {
        this.db = db;
        this.clock = clock;
        this.sender = sender;
        this.bypass = bypass;
        this.hasher = hasher;
        this.sends = sends;
    }

    /**
     * Sends a new code unless the live one is inside its cooldown or the address already had 10 sends in the last
     * rolling 24 h (silent: 204 either way). A test-domain address skips every limit and always gets a fresh row
     * with the fixed code. Returns the code to send, or null when nothing goes out. The caller delivers it after commit.
     *
     * <p>No locks. The cooldown is the guard of one upsert (it replaces the row only when the live code is older
     * than the cooldown or exhausted), so two simultaneous starts for one address store one code. The daily cap is
     * a count before it: racing starts can overshoot it by up to their number (accepted; see {@link CodeSends}).
     */
    @Nullable Outgoing start(String email, Caller caller) {
        Instant now = clock.instant();
        if (bypass.emailBypassed(email)) {
            upsert(email, bypass.code(), now, false);
            return new Outgoing(email, bypass.code());
        }
        if (sends.last24h(CodeSends.Channel.email, email).target() >= MAX_SENDS_PER_DAY) return null;

        String code = Hashing.randomDigits(6);
        if (!upsert(email, code, now, true)) return null;      // the live code is inside its cooldown
        sends.record(CodeSends.Channel.email, email, caller.personId());
        return new Outgoing(email, code);
    }

    /** The network call: never inside a transaction. */
    void deliver(Outgoing outgoing) {
        sender.sendSignInCode(outgoing.email(), outgoing.code());
    }

    /**
     * True once per code, in one atomic statement: a live code (unexpired, attempts left) is either
     * exhausted by the right code (consumed: no second request can pass the `attempts &lt; max` guard) or
     * charged one attempt by a wrong one. The caller's transaction must commit the wrong-code attempt.
     */
    boolean consume(String email, String code) {
        String submitted = hasher.hash(email, code);
        String stored = db.update(EMAIL_CODE)
                          .set(EMAIL_CODE.ATTEMPTS, DSL.when(EMAIL_CODE.CODE_HASH.eq(submitted), DSL.inline(MAX_ATTEMPTS))
                                                       .otherwise(EMAIL_CODE.ATTEMPTS.plus(1)))
                          .where(EMAIL_CODE.EMAIL.eq(email), EMAIL_CODE.ATTEMPTS.lt(MAX_ATTEMPTS),
                                 EMAIL_CODE.EXPIRES_AT.gt(clock.instant().atOffset(ZoneOffset.UTC)))
                          .returning(EMAIL_CODE.CODE_HASH)
                          .fetchOptional().map(EmailCodeRecord::getCodeHash).orElse(null);
        return stored != null && hasher.matches(stored, email, code);
    }

    /** Data minimisation: drops rows whose code has expired (the daily cap counts the send log, not this table). */
    int purgeStale() {
        return db.deleteFrom(EMAIL_CODE).where(EMAIL_CODE.EXPIRES_AT.le(clock.instant().atOffset(ZoneOffset.UTC))).execute();
    }

    /**
     * One live code per address: insert, or replace the row. With {@code guarded} the replacement happens only
     * when the stored code is out of its cooldown or out of attempts; false when the guard refused it.
     */
    private boolean upsert(String email, String code, Instant now, boolean guarded) {
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        String hash = hasher.hash(email, code);
        var insert = db.insertInto(EMAIL_CODE)
                       .set(EMAIL_CODE.EMAIL, email)
                       .set(EMAIL_CODE.CODE_HASH, hash)
                       .set(EMAIL_CODE.EXPIRES_AT, at.plus(TTL))
                       .set(EMAIL_CODE.ATTEMPTS, 0)
                       .set(EMAIL_CODE.SENT_AT, at)
                       .onConflict(EMAIL_CODE.EMAIL).doUpdate()
                       .set(EMAIL_CODE.CODE_HASH, hash)
                       .set(EMAIL_CODE.EXPIRES_AT, at.plus(TTL))
                       .set(EMAIL_CODE.ATTEMPTS, 0)
                       .set(EMAIL_CODE.SENT_AT, at);
        return (guarded
                ? insert.where(EMAIL_CODE.SENT_AT.le(at.minus(COOLDOWN)).or(EMAIL_CODE.ATTEMPTS.ge(MAX_ATTEMPTS))).execute()
                : insert.execute()) == 1;
    }
}
