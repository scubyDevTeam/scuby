package co.scuby.identity;

import co.scuby.db.generated.tables.records.EmailCodeRecord;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import static co.scuby.db.generated.Tables.EMAIL_CODE;

/** Sign-in codes (design · Behaviour decisions, Email code). Callers run these inside a transaction. */
@Component
class EmailCodes {

    static final Duration TTL = Duration.ofMinutes(5);
    static final Duration COOLDOWN = Duration.ofSeconds(60);
    static final int MAX_ATTEMPTS = 3;
    static final int MAX_SENDS_PER_DAY = 10;

    private final DSLContext db;
    private final Clock clock;
    private final EmailSender sender;
    private final TestBypass bypass;
    private final CodeHasher hasher;
    private final CodeSends sends;
    private final AuthProperties limits;

    EmailCodes(DSLContext db, Clock clock, EmailSender sender, TestBypass bypass, CodeHasher hasher,
               CodeSends sends, AuthProperties limits) {
        this.db = db;
        this.clock = clock;
        this.sender = sender;
        this.bypass = bypass;
        this.hasher = hasher;
        this.sends = sends;
        this.limits = limits;
    }

    /**
     * Sends a new code unless the live one is inside its cooldown or the address is over its daily cap
     * (silent: the caller answers 204 either way). Over the device or IP cap: rate_limited.
     * A test-domain address skips every limit and always gets a fresh row with the fixed code.
     */
    void start(String email, Caller caller) {
        Instant now = clock.instant();
        LocalDate today = now.atOffset(ZoneOffset.UTC).toLocalDate();
        if (bypass.emailBypassed(email)) {
            write(email, bypass.code(), now, today, 1);
            sender.sendSignInCode(email, bypass.code());
            return;
        }
        // Serialises concurrent starts for one address: FOR UPDATE locks nothing while no row exists.
        db.fetch("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "email_code:" + email);
        EmailCodeRecord row = db.selectFrom(EMAIL_CODE).where(EMAIL_CODE.EMAIL.eq(email)).forUpdate().fetchOne();
        boolean live = row != null && row.getAttempts() < MAX_ATTEMPTS && row.getExpiresAt().toInstant().isAfter(now);
        if (live && row.getSentAt().toInstant().plus(COOLDOWN).isAfter(now)) return;
        int sendsToday = row != null && row.getSendsDay().equals(today) ? row.getSendsOnDay() : 0;
        if (sendsToday >= MAX_SENDS_PER_DAY) return;

        CodeSends.Counts counts = sends.last24h(CodeSends.Channel.email, email, caller.deviceHash(), caller.ipHash());
        if (counts.device() >= limits.emailMaxPerDevice() || counts.ip() >= limits.emailMaxPerIp()) {
            throw new ApiException(ErrorCode.RATE_LIMITED, "too many codes requested");
        }
        String code = Hashing.randomDigits(6);
        write(email, code, now, today, sendsToday + 1);
        sends.record(CodeSends.Channel.email, email, caller.personId(), caller.deviceHash(), caller.ipHash());
        sender.sendSignInCode(email, code);
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
        // Keep the row (its send counters gate the daily cap); make the code unusable — and no longer "live",
        // so the next start sends a fresh code at once.
        db.update(EMAIL_CODE).set(EMAIL_CODE.ATTEMPTS, MAX_ATTEMPTS).where(EMAIL_CODE.EMAIL.eq(email)).execute();
        return true;
    }

    private void write(String email, String code, Instant now, LocalDate today, int sendsOnDay) {
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        String hash = hasher.hash(email, code);
        db.insertInto(EMAIL_CODE)
          .set(EMAIL_CODE.EMAIL, email)
          .set(EMAIL_CODE.CODE_HASH, hash)
          .set(EMAIL_CODE.EXPIRES_AT, at.plus(TTL))
          .set(EMAIL_CODE.ATTEMPTS, 0)
          .set(EMAIL_CODE.SENT_AT, at)
          .set(EMAIL_CODE.SENDS_DAY, today)
          .set(EMAIL_CODE.SENDS_ON_DAY, sendsOnDay)
          .onConflict(EMAIL_CODE.EMAIL).doUpdate()
          .set(EMAIL_CODE.CODE_HASH, hash)
          .set(EMAIL_CODE.EXPIRES_AT, at.plus(TTL))
          .set(EMAIL_CODE.ATTEMPTS, 0)
          .set(EMAIL_CODE.SENT_AT, at)
          .set(EMAIL_CODE.SENDS_DAY, today)
          .set(EMAIL_CODE.SENDS_ON_DAY, sendsOnDay)
          .execute();
    }
}
