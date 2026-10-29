package co.scuby.identity;

import co.scuby.platform.cache.ClearableCache;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

import java.time.Clock;
import java.util.Optional;

/**
 * A bounded, short-lived cache in front of the lookup. Only live sessions are cached; the expiry is
 * re-checked against the clock on every hit; sign-out evicts locally (one instance today).
 */
final class CachingSessionLookup implements SessionLookup, ClearableCache {

    private final SessionLookup delegate;
    private final Clock clock;
    private final Cache<String, ActiveSession> cache;

    CachingSessionLookup(SessionLookup delegate, SessionProperties properties, Clock clock) {
        this.delegate = delegate;
        this.clock = clock;
        this.cache = Caffeine.newBuilder()
                             .maximumSize(properties.cacheSize())
                             .expireAfterWrite(properties.cacheTtl())
                             .build();
    }

    @Override
    public Optional<ActiveSession> find(String tokenHash) {
        ActiveSession cached = cache.getIfPresent(tokenHash);
        if (cached != null) {
            if (cached.expiresAt().isAfter(clock.instant())) return Optional.of(cached);
            cache.invalidate(tokenHash);
            return Optional.empty();
        }
        Optional<ActiveSession> found = delegate.find(tokenHash);
        found.ifPresent(s -> cache.put(tokenHash, s));
        return found;
    }

    @Override
    public void evict(String tokenHash) {
        cache.invalidate(tokenHash);
    }

    @Override
    public void clear() {
        cache.invalidateAll();
    }
}
