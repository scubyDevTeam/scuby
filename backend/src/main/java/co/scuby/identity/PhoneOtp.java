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

/**
 * SMS one-time codes with the full checklist of docs/eng/auth.md · OTP mechanics.
 *
 * <p>Known and accepted until a real SMS provider exists (R1): the after-commit send still runs on the request
 * thread, so the request's connection is held while the provider is called.
 */
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
    private final People people;

    PhoneOtp(DSLContext db, Clock clock, SmsSender sender, TestBypass bypass, SmsProperties limits,
             CodeHasher hasher, CodeSends sends, People people) {
        this.people = people;
        this.db = db;
        this.clock = clock;
        this.sender = sender;
        this.bypass = bypass;
        this.limits = limits;
        this.hasher = hasher;
        this.sends = sends;
    }

    /**
     * Sends a code to a number already validated by PhoneNumbers (a mobile of a supported country). Inside the
     * 60 s cooldown: no resend, answered as sent. At most 5 sends per number in a rolling 24 h, from any account.
     * A test number skips the cooldown and the cap, sends nothing, writes no send record and always gets the fixed code.
     */
    @Transactional
    public Sent send(UUID personId, String phone, Caller caller) {
        // Lock order everywhere: person row, then (advisory locks and) the phone_otp row. The send-log and
        // phone_otp inserts need the person row for their foreign keys, so taking it last deadlocked with a
        // publish (PublisherPhone.resolve) and with an email-code reclaim, which both take it first.
        people.lock(personId);
        return sendHoldingPersonLock(personId, phone, caller);
    }

    /**
     * {@link #send} for a caller that already holds the person row's lock in this transaction
     * (PublisherPhone.resolve): same behaviour, without locking the row a second time.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    Sent sendHoldingPersonLock(UUID personId, String phone, Caller caller) {
        Instant now = clock.instant();
        if (bypass.smsBypassed(phone)) {
            write(personId, phone, bypass.code(), now);
            return Sent.SENT;
        }
        // The cap is counted from rows other transactions may be about to insert, so the number's counter is
        // serialised. Nothing to row-lock for the number while no row exists yet, hence the advisory lock.
        lock("phone_otp:" + phone);
        PhoneOtpRecord pending = db.selectFrom(PHONE_OTP)
                                   .where(PHONE_OTP.PERSON_ID.eq(personId), PHONE_OTP.PHONE.eq(phone))
                                   .fetchOne();
        if (pending != null && pending.getSentAt().toInstant().plus(COOLDOWN).isAfter(now)) return Sent.COOLDOWN;
        CodeSends.Counts counts = sends.last24h(CodeSends.Channel.sms, phone);
        if (counts.target() >= limits.maxPerNumber()) {
            throw new ApiException(ErrorCode.RATE_LIMITED, "too many codes sent");
        }

        String code = Hashing.randomDigits(6);
        write(personId, phone, code, now);
        sends.record(CodeSends.Channel.sms, phone, personId, caller.deviceHash());
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

        boolean isFor(String otherPhone) {
            return phone.equals(otherPhone);
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
