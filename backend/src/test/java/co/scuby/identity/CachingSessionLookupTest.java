package co.scuby.identity;

import co.scuby.support.MutableClock;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class CachingSessionLookupTest {

    @Test
    void aLoadInFlightWhenTheSessionIsEvictedIsNeverServedAfterwards() throws Exception {
        MutableClock clock = new MutableClock();
        ActiveSession session = new ActiveSession(UUID.randomUUID(), clock.instant().plus(Duration.ofDays(30)));
        CountDownLatch loading = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        // The database still has the row when the load reads it; the sign-out's delete commits right after.
        boolean[] deleted = {false};
        SessionLookup slow = new SessionLookup() {
            @Override public void evict(String hash) {}
            @Override public Optional<ActiveSession> find(String hash) {
            Optional<ActiveSession> read = deleted[0] ? Optional.empty() : Optional.of(session);
            loading.countDown();
            try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            return read;
            }
        };
        var cache = new CachingSessionLookup(slow, new SessionProperties(100, Duration.ofSeconds(60), 12), clock);

        CompletableFuture<Optional<ActiveSession>> inFlight = CompletableFuture.supplyAsync(() -> cache.find("t"));
        assertThat(loading.await(5, TimeUnit.SECONDS)).isTrue();
        deleted[0] = true;                                          // sign-out: row deleted ...
        CompletableFuture<Void> evicting = CompletableFuture.runAsync(() -> cache.evict("t"));   // ... then evicted
        release.countDown();
        inFlight.get(5, TimeUnit.SECONDS);
        evicting.get(5, TimeUnit.SECONDS);

        assertThat(cache.find("t")).as("the revoked token must not come back from the cache").isEmpty();
    }
}
