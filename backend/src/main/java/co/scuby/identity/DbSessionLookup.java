package co.scuby.identity;

import org.jooq.DSLContext;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.Optional;

import static co.scuby.db.generated.Tables.SESSION;

/** One autocommit SELECT; the connection goes back to the pool before the controller runs. */
final class DbSessionLookup implements SessionLookup {

    private final DSLContext db;
    private final Clock clock;

    DbSessionLookup(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    @Override
    public Optional<ActiveSession> find(String tokenHash) {
        return db.select(SESSION.PERSON_ID, SESSION.EXPIRES_AT)
                 .from(SESSION)
                 .where(SESSION.TOKEN_HASH.eq(tokenHash))
                 .and(SESSION.EXPIRES_AT.gt(clock.instant().atOffset(ZoneOffset.UTC)))
                 .fetchOptional(r -> new ActiveSession(r.value1(), r.value2().toInstant()));
    }

    @Override
    public void evict(String tokenHash) {}
}
