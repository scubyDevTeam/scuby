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
import java.util.Optional;
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

    PhoneOtp(DSLContext db, Clock clock, SmsSender sender, TestBypass bypass, SmsProperties limits,
             CodeHasher hasher, CodeSends sends) {
        this.db = db;
        this.clock = clock;
        this.sender = sender;
        this.bypass = bypass;
        this.limits = limits;
        this.hasher = hasher;
        this.sends = sends;
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
        // Caps are counted from rows other transactions may be about to insert, so each cap's counter is
        // serialised: IP, then device, then number, always in that order (no deadlock). Without the first two,
        // a parallel burst across different numbers all read the same count and overshoots the IP/device cap.
        // Nothing to row-lock for the number while no row exists yet, hence the advisory lock.
        lock("sms_ip:" + caller.ipHash());
        lock("sms_dev:" + caller.deviceHash());
        lock("phone_otp:" + phone);
        CodeSends.Counts counts = sends.last24h(CodeSends.Channel.sms, phone, personId, caller.deviceHash(), caller.ipHash());
        if (counts.device() >= limits.maxPerDevice() || counts.ip() >= limits.maxPerIp()
                || counts.account() >= limits.maxPerAccount()) {
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
        // After the (possibly outer, e.g. the publish's) transaction commits: see AfterCommit.
        AfterCommit.run(() -> sender.sendCode(phone, code));
        return Sent.SENT;
    }

    /**
     * A correct code whose attempt is already counted; consume it inside the transaction that does the work.
     * Opaque: only {@link #reserveAndCheck} makes one.
     */
    static final class Reservation {
        private final UUID personId;
        private final String phone;
        private final String codeHash;

        private Reservation(UUID personId, String phone, String codeHash) {
            this.personId = personId;
            this.phone = phone;
            this.codeHash = codeHash;
        }
    }

    /**
     * Step 1 of a code check, RESERVE FIRST: counts the attempt in its own autocommit statement, before the
     * caller opens any transaction (NEVER: fails fast if one is open). A miss therefore survives the caller's
     * rollback without a second connection (a REQUIRES_NEW inside the caller's transaction needs two
     * connections per request and stalls the pool under concurrent wrong codes). The single conditional
     * UPDATE is atomic, so concurrent attempts can never exceed {@link #MAX_ATTEMPTS}.
     * Returns empty for a wrong, expired, exhausted or absent code; a reservation for a right one.
     * A rolled-back caller still spent the attempt.
     */
    @Transactional(propagation = Propagation.NEVER)
    public Optional<Reservation> reserveAndCheck(UUID personId, String phone, String code) {
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        String hash = db.update(PHONE_OTP)
                        .set(PHONE_OTP.ATTEMPTS, PHONE_OTP.ATTEMPTS.plus(1))
                        .where(PHONE_OTP.PERSON_ID.eq(personId), PHONE_OTP.PHONE.eq(phone),
                               PHONE_OTP.EXPIRES_AT.gt(now), PHONE_OTP.ATTEMPTS.lt(MAX_ATTEMPTS))
                        .returning(PHONE_OTP.CODE_HASH)
                        .fetchOptional().map(PhoneOtpRecord::getCodeHash).orElse(null);
        if (hash == null || !hasher.matches(hash, phone, code)) return Optional.empty();
        return Optional.of(new Reservation(personId, phone, hash));
    }

    /**
     * Step 2, inside the caller's transaction (MANDATORY): true once per reserved code. The conditional DELETE
     * commits only with the caller, so a rolled-back publish leaves the code usable (its attempt stays spent).
     * Of two concurrent reservations of one code, one deletes the row and the other gets false; a resend
     * in between changes the hash and also gets false.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean consume(Reservation r) {
        return db.deleteFrom(PHONE_OTP)
                 .where(PHONE_OTP.PERSON_ID.eq(r.personId), PHONE_OTP.PHONE.eq(r.phone),
                        PHONE_OTP.CODE_HASH.eq(r.codeHash),
                        PHONE_OTP.EXPIRES_AT.gt(clock.instant().atOffset(ZoneOffset.UTC)))
                 .execute() == 1;
    }

    private void lock(String key) {
        db.fetch("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", key);
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
