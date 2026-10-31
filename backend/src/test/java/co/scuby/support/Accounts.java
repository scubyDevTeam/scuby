package co.scuby.support;

import co.scuby.platform.crypto.Hashing;
import org.jooq.DSLContext;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.SESSION;

/** Test shortcuts that bypass sign-in (the sign-in endpoints have their own tests). */
public final class Accounts {

    private final DSLContext db;
    private final Clock clock;

    Accounts(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    public UUID person(String email) {
        UUID id = UUID.randomUUID();
        db.insertInto(PERSON)
          .set(PERSON.ID, id)
          .set(PERSON.DISPLAY_NAME, email.substring(0, email.indexOf('@')))
          .set(PERSON.EMAIL, email.toLowerCase(Locale.ROOT))
          .set(PERSON.CREATED_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .execute();
        return id;
    }

    public UUID signIn(ApiClient api, String email) {
        UUID id = person(email);
        String token = Hashing.randomToken(32);
        db.insertInto(SESSION)
          .set(SESSION.TOKEN_HASH, Hashing.sha256Hex(token))
          .set(SESSION.PERSON_ID, id)
          .set(SESSION.CREATED_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .set(SESSION.EXPIRES_AT, clock.instant().atOffset(ZoneOffset.UTC).plusMonths(12))
          .execute();
        api.setCookie("__Host-session", token);
        return id;
    }
}
