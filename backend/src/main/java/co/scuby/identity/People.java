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

    Optional<Person> byEmail(String normalizedEmail) {
        return db.selectFrom(PERSON).where(PERSON.EMAIL.eq(normalizedEmail)).fetchOptional().map(People::toPerson);
    }

    Optional<Person> byGoogleSub(String sub) {
        return db.selectFrom(PERSON).where(PERSON.GOOGLE_SUB.eq(sub)).fetchOptional().map(People::toPerson);
    }

    /** Creates the account, or returns the one a concurrent sign-in just created (same email, or same Google identity). */
    Person create(String normalizedEmail, String displayName, boolean displayNameChosen, @Nullable String googleSub) {
        db.insertInto(PERSON)
          .set(PERSON.ID, UUID.randomUUID())
          .set(PERSON.EMAIL, normalizedEmail)
          .set(PERSON.DISPLAY_NAME, displayName)
          .set(PERSON.DISPLAY_NAME_CHOSEN, displayNameChosen)
          .set(PERSON.GOOGLE_SUB, googleSub)
          .set(PERSON.CREATED_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .onConflictDoNothing()   // any unique key: the email, or a google_sub a concurrent sign-in just set
          .execute();
        Optional<Person> byEmail = byEmail(normalizedEmail);
        if (byEmail.isPresent() || googleSub == null) return byEmail.orElseThrow();
        return byGoogleSub(googleSub).orElseThrow();
    }

    /**
     * Creates the account only if nothing conflicts. Empty when the email already belongs to another account (the
     * caller must not link to it); when only the Google identity conflicts, that is the same person's concurrent
     * sign-in and its account is returned.
     */
    Optional<Person> createIfNew(String normalizedEmail, String displayName, boolean displayNameChosen, String googleSub) {
        int inserted = db.insertInto(PERSON)
          .set(PERSON.ID, UUID.randomUUID())
          .set(PERSON.EMAIL, normalizedEmail)
          .set(PERSON.DISPLAY_NAME, displayName)
          .set(PERSON.DISPLAY_NAME_CHOSEN, displayNameChosen)
          .set(PERSON.GOOGLE_SUB, googleSub)
          .set(PERSON.CREATED_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .onConflictDoNothing()
          .execute();
        if (inserted == 1) return byEmail(normalizedEmail);
        return byGoogleSub(googleSub).filter(p -> p.email().equals(normalizedEmail));
    }

    /** Sets the Google identity only while the account has none; false when it already has one (never overwritten). */
    boolean linkGoogle(UUID id, String sub) {
        return db.update(PERSON).set(PERSON.GOOGLE_SUB, sub)
                 .where(PERSON.ID.eq(id).and(PERSON.GOOGLE_SUB.isNull()))
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
        return new Person(r.getId(), r.getDisplayName(), r.getEmail(), r.getGoogleSub(), r.getPhone(),
                r.getPhoneVerifiedAt() == null ? null : r.getPhoneVerifiedAt().toInstant(),
                r.getCity(), r.getBio(), r.getNotifyLost(), r.getNotifyFound(), r.getNotifyAdoption(),
                r.getNotifyHelp(), r.getPhotoUrl());
    }
}
