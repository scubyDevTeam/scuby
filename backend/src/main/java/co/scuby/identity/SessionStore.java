package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.SESSION;

/** Session writes happen only here: sign-in, sign-out, the purge (account deletion cascades). */
@Component
class SessionStore {

    private final DSLContext db;
    private final Clock clock;
    private final SessionLookup lookup;
    private final SessionProperties properties;

    SessionStore(DSLContext db, Clock clock, SessionLookup lookup, SessionProperties properties) {
        this.db = db;
        this.clock = clock;
        this.lookup = lookup;
        this.properties = properties;
    }

    /** Returns the raw token for the cookie (only its hash is stored) and the expiry the cookie must match. */
    NewSession create(UUID personId) {
        String token = Hashing.randomToken(32);
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        OffsetDateTime expiresAt = now.plusMonths(properties.lifetimeMonths());
        db.insertInto(SESSION)
          .set(SESSION.TOKEN_HASH, Hashing.sha256Hex(token))
          .set(SESSION.PERSON_ID, personId)
          .set(SESSION.CREATED_AT, now)
          .set(SESSION.EXPIRES_AT, expiresAt)
          .execute();
        return new NewSession(token, expiresAt.toInstant());
    }

    void delete(String tokenHash) {
        db.deleteFrom(SESSION).where(SESSION.TOKEN_HASH.eq(tokenHash)).execute();
        evictAfterCommit(tokenHash);
    }

    /** Ends every session of the person (e.g. a credential was revoked); the cache is evicted after commit. */
    void deleteAllOf(UUID personId) {
        db.deleteFrom(SESSION).where(SESSION.PERSON_ID.eq(personId)).returning(SESSION.TOKEN_HASH)
          .fetch(SESSION.TOKEN_HASH).forEach(this::evictAfterCommit);
    }

    /**
     * Evicting before the commit lets a concurrent request still see the row and re-cache the session; so
     * inside a transaction the eviction runs after it commits (and also now, to shorten the window).
     */
    private void evictAfterCommit(String tokenHash) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { lookup.evict(tokenHash); }
            });
        }
        lookup.evict(tokenHash);
    }

    int purgeExpired() {
        return db.deleteFrom(SESSION)
                 .where(SESSION.EXPIRES_AT.le(clock.instant().atOffset(ZoneOffset.UTC)))
                 .execute();
    }
}
