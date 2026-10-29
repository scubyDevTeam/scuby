package co.scuby.identity;

import co.scuby.db.generated.tables.records.PhoneOtpRecord;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PHONE_OTP;

/** SMS one-time codes with the full checklist of docs/eng/auth.md · OTP mechanics. */
@Component
class PhoneOtp {

    enum Sent { SENT, COOLDOWN }

    static final Duration TTL = Duration.ofMinutes(5);
    static final Duration COOLDOWN = Duration.ofSeconds(60);
    static final int MAX_ATTEMPTS = 3;

    private static final Logger log = LoggerFactory.getLogger(PhoneOtp.class);

    private final DSLContext db;
    private final Clock clock;
    private final SmsSender sender;
    private final TestBypass bypass;
    private final SmsProperties limits;
    private final CodeHasher hasher;
    private final CodeSends sends;
    private final PhoneOtpMisses misses;

    PhoneOtp(DSLContext db, Clock clock, SmsSender sender, TestBypass bypass, SmsProperties limits,
             CodeHasher hasher, CodeSends sends, PhoneOtpMisses misses) {
        this.db = db;
        this.clock = clock;
        this.sender = sender;
        this.bypass = bypass;
        this.limits = limits;
        this.hasher = hasher;
        this.sends = sends;
        this.misses = misses;
    }

    /**
     * Sends a code to a number already validated by PhoneNumbers. The device and IP caps are checked first, for
     * every number (a capped caller learns nothing about any number's cooldown or count). Inside the cooldown:
     * no resend. A test number skips the cooldown and the throttles, sends nothing, writes no send record and
     * always gets the fixed code.
     */
    @Transactional
    public Sent send(UUID personId, String phone, Caller caller) {
        Instant now = clock.instant();
        if (bypass.smsBypassed(phone)) {
            write(personId, phone, bypass.code(), now);
            return Sent.SENT;
        }
        // Serialises concurrent starts for one number: nothing to lock while no row exists yet.
        db.fetch("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "phone_otp:" + phone);
        CodeSends.Counts counts = sends.last24h(CodeSends.Channel.sms, phone, caller.deviceHash(), caller.ipHash());
        if (counts.device() >= limits.maxPerDevice() || counts.ip() >= limits.maxPerIp()) {
            throw new ApiException(ErrorCode.RATE_LIMITED, "too many codes sent");
        }
        PhoneOtpRecord pending = db.selectFrom(PHONE_OTP)
                                   .where(PHONE_OTP.PERSON_ID.eq(personId), PHONE_OTP.PHONE.eq(phone))
                                   .fetchOne();
        if (pending != null && pending.getSentAt().toInstant().plus(COOLDOWN).isAfter(now)) return Sent.COOLDOWN;
        if (counts.target() >= limits.maxPerNumber()) {
            throw new ApiException(ErrorCode.RATE_LIMITED, "too many codes sent");
        }

        String code = Hashing.randomDigits(6);
        write(personId, phone, code, now);
        sends.record(CodeSends.Channel.sms, phone, personId, caller.deviceHash(), caller.ipHash());
        if (counts.all() + 1 > limits.alarmDailySends()) {
            log.warn("sms.daily_send_alarm sends_24h={} threshold={}", counts.all() + 1, limits.alarmDailySends());
        }
        // O23: a real provider must be called AFTER this transaction commits (a TransactionSynchronization
        // afterCommit), or a rollback would leave a texted code that was never stored. The log adapter needn't.
        sender.sendCode(phone, code);
        return Sent.SENT;
    }

    /**
     * True once per code, inside the caller's transaction (MANDATORY): the right code is consumed by a
     * conditional DELETE that commits only with the caller, so a rolled-back publish leaves it usable.
     * A wrong code is counted by PhoneOtpMisses in its own transaction, so the miss survives the
     * caller's rollback. The row is read without FOR UPDATE: the miss's UPDATE must not wait on a lock
     * held by its own caller.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean check(UUID personId, String phone, String code) {
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        PhoneOtpRecord row = db.selectFrom(PHONE_OTP)
                               .where(PHONE_OTP.PERSON_ID.eq(personId), PHONE_OTP.PHONE.eq(phone))
                               .fetchOne();
        if (row == null || row.getAttempts() >= MAX_ATTEMPTS || !row.getExpiresAt().isAfter(now)) return false;
        if (!hasher.matches(row.getCodeHash(), phone, code)) {
            misses.record(personId, phone);
            return false;
        }
        // Atomic consume: a concurrent check of the same code deletes nothing and gets false.
        return db.deleteFrom(PHONE_OTP)
                 .where(PHONE_OTP.PERSON_ID.eq(personId), PHONE_OTP.PHONE.eq(phone),
                        PHONE_OTP.CODE_HASH.eq(row.getCodeHash()),
                        PHONE_OTP.ATTEMPTS.lt(MAX_ATTEMPTS), PHONE_OTP.EXPIRES_AT.gt(now))
                 .execute() == 1;
    }

    /** Drops every pending code of an account (an account reclaim: codes requested while an attacker held it). */
    void discardAllOf(UUID personId) {
        db.deleteFrom(PHONE_OTP).where(PHONE_OTP.PERSON_ID.eq(personId)).execute();
    }

    int purgeExpiredBefore(Duration age) {
        OffsetDateTime cutoff = clock.instant().minus(age).atOffset(ZoneOffset.UTC);
        return db.deleteFrom(PHONE_OTP).where(PHONE_OTP.EXPIRES_AT.lt(cutoff)).execute();
    }

    private void write(UUID personId, String phone, String code, Instant now) {
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        String hash = hasher.hash(phone, code);
        db.insertInto(PHONE_OTP)
          .set(PHONE_OTP.PERSON_ID, personId).set(PHONE_OTP.PHONE, phone)
          .set(PHONE_OTP.CODE_HASH, hash).set(PHONE_OTP.EXPIRES_AT, at.plus(TTL))
          .set(PHONE_OTP.ATTEMPTS, 0).set(PHONE_OTP.SENT_AT, at)
          .onConflict(PHONE_OTP.PERSON_ID, PHONE_OTP.PHONE).doUpdate()
          .set(PHONE_OTP.CODE_HASH, hash).set(PHONE_OTP.EXPIRES_AT, at.plus(TTL))
          .set(PHONE_OTP.ATTEMPTS, 0).set(PHONE_OTP.SENT_AT, at)
          .execute();
    }
}
