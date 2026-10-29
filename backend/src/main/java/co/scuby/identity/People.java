package co.scuby.identity;

import co.scuby.db.generated.tables.records.PersonRecord;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;

/** The only writer of `person`. Emails arrive already normalised: trim + lower(Locale.ROOT); the DB CHECK enforces it. */
@Component
class People {

    private final DSLContext db;
    private final Clock clock;

    People(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    Person get(UUID id) {
        return db.selectFrom(PERSON).where(PERSON.ID.eq(id)).fetchOptional().map(People::toPerson)
                 .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED, "the account no longer exists"));
    }

    /** Reads the row with `FOR UPDATE`: serialises with the unlink (an UPDATE of the same row) and re-reads the committed state. */
    Person lock(UUID id) {
        return db.selectFrom(PERSON).where(PERSON.ID.eq(id)).forUpdate().fetchOptional().map(People::toPerson)
                 .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED, "the account no longer exists"));
    }

    Optional<Person> byEmail(String normalizedEmail) {
        return db.selectFrom(PERSON).where(PERSON.EMAIL.eq(normalizedEmail)).fetchOptional().map(People::toPerson);
    }

    Optional<Person> byGoogleSub(String sub) {
        return db.selectFrom(PERSON).where(PERSON.GOOGLE_SUB.eq(sub)).fetchOptional().map(People::toPerson);
    }

    /** Creates the account, or returns the one a concurrent sign-in just created (same email, or same Google identity). */
    Person create(String normalizedEmail, String displayName, @Nullable String googleSub, boolean googleEmailAuthoritative) {
        db.insertInto(PERSON)
          .set(PERSON.ID, UUID.randomUUID())
          .set(PERSON.EMAIL, normalizedEmail)
          .set(PERSON.DISPLAY_NAME, displayName)
          .set(PERSON.GOOGLE_SUB, googleSub)
          .set(PERSON.GOOGLE_EMAIL_AUTHORITATIVE, googleSub == null ? null : googleEmailAuthoritative)
          .set(PERSON.CREATED_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .onConflictDoNothing()   // any unique key: the email, or a google_sub a concurrent sign-in just set
          .execute();
        Optional<Person> byEmail = byEmail(normalizedEmail);
        if (byEmail.isPresent() || googleSub == null) return byEmail.orElseThrow();
        return byGoogleSub(googleSub).orElseThrow();
    }

    /** Sets the Google identity only while the account has none; false when it already has one (never overwritten). */
    boolean linkGoogle(UUID id, String sub, boolean emailAuthoritative) {
        return db.update(PERSON).set(PERSON.GOOGLE_SUB, sub).set(PERSON.GOOGLE_EMAIL_AUTHORITATIVE, emailAuthoritative)
                 .where(PERSON.ID.eq(id).and(PERSON.GOOGLE_SUB.isNull()))
                 .execute() == 1;
    }

    /**
     * Drops the Google identity (and its flag) only while it is still non-authoritative; false if nothing changed.
     * In the same statement it forgets the phone and its verification: whoever held the account through that
     * link may have attached a number of their own, and the display name came from their Google profile, so it
     * goes back to {@code resetDisplayName}.
     */
    boolean unlinkNonAuthoritativeGoogle(UUID id, String resetDisplayName) {
        return db.update(PERSON).setNull(PERSON.GOOGLE_SUB).setNull(PERSON.GOOGLE_EMAIL_AUTHORITATIVE)
                 .setNull(PERSON.PHONE).setNull(PERSON.PHONE_VERIFIED_AT)
                 .set(PERSON.DISPLAY_NAME, resetDisplayName)
                 .where(PERSON.ID.eq(id).and(PERSON.GOOGLE_EMAIL_AUTHORITATIVE.isFalse()))
                 .execute() == 1;
    }

    /** Verification belongs to the number: a new number starts unverified unless verifiedAt is given. */
    void setPhone(UUID id, String e164, @Nullable Instant verifiedAt) {
        db.update(PERSON)
          .set(PERSON.PHONE, e164)
          .set(PERSON.PHONE_VERIFIED_AT, verifiedAt == null ? null : verifiedAt.atOffset(ZoneOffset.UTC))
          .where(PERSON.ID.eq(id))
          .execute();
    }

    private static Person toPerson(PersonRecord r) {
        return new Person(r.getId(), r.getDisplayName(), r.getEmail(), r.getGoogleSub(), r.getGoogleEmailAuthoritative(), r.getPhone(),
                r.getPhoneVerifiedAt() == null ? null : r.getPhoneVerifiedAt().toInstant(),
                r.getCity(), r.getBio(), r.getNotifyLost(), r.getNotifyFound(), r.getNotifyAdoption(),
                r.getNotifyHelp(), r.getPhotoUrl());
    }
}
