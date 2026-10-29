package co.scuby.identity;

import java.util.Optional;

/** Finds a live session by its token's hash. Implementations never write and never open a transaction. */
interface SessionLookup {
    Optional<ActiveSession> find(String tokenHash);

    void evict(String tokenHash);
}
