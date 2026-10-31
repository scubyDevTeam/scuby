package co.scuby.identity;

import co.scuby.db.generated.tables.records.EmailCodeRecord;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
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
     */
    @Nullable Outgoing start(String email, Caller caller) {
        Instant now = clock.instant();
        if (bypass.emailBypassed(email)) {
            write(email, bypass.code(), now);
            return new Outgoing(email, bypass.code());
        }
        // Serialises concurrent starts for one address: FOR UPDATE locks nothing while no row exists.
        db.fetch("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "email_code:" + email);
        EmailCodeRecord row = db.selectFrom(EMAIL_CODE).where(EMAIL_CODE.EMAIL.eq(email)).forUpdate().fetchOne();
        boolean live = row != null && row.getAttempts() < MAX_ATTEMPTS && row.getExpiresAt().toInstant().isAfter(now);
        if (live && row.getSentAt().toInstant().plus(COOLDOWN).isAfter(now)) return null;
        if (sends.last24h(CodeSends.Channel.email, email).target() >= MAX_SENDS_PER_DAY) return null;

        String code = Hashing.randomDigits(6);
        write(email, code, now);
        sends.record(CodeSends.Channel.email, email, caller.personId(), caller.deviceHash());
        return new Outgoing(email, code);
    }

    /** The network call: never inside a transaction. */
    void deliver(Outgoing outgoing) {
        sender.sendSignInCode(outgoing.email(), outgoing.code());
    }

    /** True once per code: a right code is consumed; a wrong one costs an attempt (the caller's transaction must commit it). */
    boolean consume(String email, String code) {
        EmailCodeRecord row = db.selectFrom(EMAIL_CODE).where(EMAIL_CODE.EMAIL.eq(email)).forUpdate().fetchOne();
        if (row == null || row.getAttempts() >= MAX_ATTEMPTS || !row.getExpiresAt().toInstant().isAfter(clock.instant())) {
            return false;
        }
        if (!hasher.matches(row.getCodeHash(), email, code)) {
            db.update(EMAIL_CODE).set(EMAIL_CODE.ATTEMPTS, row.getAttempts() + 1).where(EMAIL_CODE.EMAIL.eq(email)).execute();
            return false;
        }
        // Keep the row; make the code unusable — and no longer "live",
        // so the next start sends a fresh code at once.
        db.update(EMAIL_CODE).set(EMAIL_CODE.ATTEMPTS, MAX_ATTEMPTS).where(EMAIL_CODE.EMAIL.eq(email)).execute();
        return true;
    }

    /** Data minimisation: drops rows whose code has expired (the daily cap counts the send log, not this table). */
    int purgeStale() {
        return db.deleteFrom(EMAIL_CODE).where(EMAIL_CODE.EXPIRES_AT.le(clock.instant().atOffset(ZoneOffset.UTC))).execute();
    }

    private void write(String email, String code, Instant now) {
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        String hash = hasher.hash(email, code);
        db.insertInto(EMAIL_CODE)
          .set(EMAIL_CODE.EMAIL, email)
          .set(EMAIL_CODE.CODE_HASH, hash)
          .set(EMAIL_CODE.EXPIRES_AT, at.plus(TTL))
          .set(EMAIL_CODE.ATTEMPTS, 0)
          .set(EMAIL_CODE.SENT_AT, at)
          .onConflict(EMAIL_CODE.EMAIL).doUpdate()
          .set(EMAIL_CODE.CODE_HASH, hash)
          .set(EMAIL_CODE.EXPIRES_AT, at.plus(TTL))
          .set(EMAIL_CODE.ATTEMPTS, 0)
          .set(EMAIL_CODE.SENT_AT, at)
          .execute();
    }
}
