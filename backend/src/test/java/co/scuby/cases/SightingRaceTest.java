package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Requests that overlap in time, made deterministic: the test holds the case row's lock, lets the requests pile
 * up behind it (each has passed every check outside the transaction and waits at the FOR SHARE status read),
 * then releases it.
 */
@IntegrationTest
class SightingRaceTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient api;
    UUID me;
    ExecutorService pool = Executors.newFixedThreadPool(4);
    Connection holder;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        cases.luna(accounts.person("carolina@correo.co"));
        me = accounts.signIn(api, "helper@correo.co");
    }

    @AfterEach
    void tearDown() throws Exception {
        if (holder != null && !holder.isClosed()) { holder.rollback(); holder.close(); }
        pool.shutdownNow();
    }

    private String body(String extra) {
        return """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null,"contact_phone":null%s}""".formatted(clock.instant(), extra);
    }

    private ApiResponse post(String extra) {
        return api.post("/cases/{code}/sightings", body(extra), "7K3PQ");
    }

    /** Locks the case row, as a close or a purge would: the sightings queue at their FOR SHARE read. */
    private void holdTheCaseLock(String update) throws Exception {
        holder = dataSource.getConnection();
        holder.setAutoCommit(false);
        try (PreparedStatement ps = holder.prepareStatement(update)) {
            ps.execute();
        }
    }

    private void holdTheCaseLock() throws Exception {
        holdTheCaseLock("SELECT 1 FROM scuby.lost_case WHERE code = '7K3PQ' FOR UPDATE");
    }

    private static final String WAITING = "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()";

    private void waitUntilWaiting(int requests) throws Exception {
        for (int i = 0; i < 500; i++) {
            Integer waiting = db.fetchOne(WAITING).get(0, Integer.class);
            if (waiting == requests) return;
            Thread.sleep(20);
        }
        throw new AssertionError("the requests never queued behind the lock (waiting: " + db.fetchOne(WAITING) + ")");
    }

    private void release() throws Exception {
        holder.commit();
        holder.close();
    }

    private List<ApiResponse> concurrently(List<Callable<ApiResponse>> calls) throws Exception {
        List<Future<ApiResponse>> futures = calls.stream().map(pool::submit).toList();
        waitUntilWaiting(calls.size());
        release();
        return futures.stream().map(f -> {
            try { return f.get(30, TimeUnit.SECONDS); } catch (Exception e) { throw new AssertionError(e); }
        }).toList();
    }

    @Test
    void twoConcurrentSendsOfOneClientIdAreTheSameSightingAndOneRow() throws Exception {
        holdTheCaseLock();
        Callable<ApiResponse> send = () -> post(",\"client_id\":\"queued-retry-1\"");
        List<ApiResponse> both = concurrently(List.of(send, send));
        assertThat(both).extracting(ApiResponse::status).containsExactly(201, 201);
        assertThat(both.get(0).str("/id")).isEqualTo(both.get(1).str("/id"));
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
    }

    @Test
    void aCaseClosedWhileTheRequestWaitedIsRefused() throws Exception {
        holdTheCaseLock("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        Future<ApiResponse> f = pool.submit(() -> post(""));
        waitUntilWaiting(1);
        release();
        assertThat(f.get(30, TimeUnit.SECONDS).errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(SIGHTING)).isZero();
    }

    /** Both passed the replay check; the second hits ON CONFLICT and re-selects: the longest path. */
    @Test
    void theLongestPathIsMeasuredExactlyOnTheConflictRaceWithPhotosAndAPhone() throws Exception {
        byte[] bytes = "race-photo".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        String url = api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        String extra = ",\"photo_urls\":[\"" + url + "\"],\"client_id\":\"long-path-1\"";
        Callable<ApiResponse> send = () -> api.post("/cases/{code}/sightings",
                body(extra).replace("\"contact_phone\":null", "\"contact_phone\":\"+573001112233\""), "7K3PQ");
        holdTheCaseLock();
        caches.orderedStream().filter(c -> c.getClass().getSimpleName().equals("CachingSessionLookup")).forEach(ClearableCache::clear);   // the session lookup counts; the stored photo stays
        List<ApiResponse> both = concurrently(List.of(send, send));
        assertThat(both).extracting(ApiResponse::status).containsExactly(201, 201);
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        // The loser re-selects the winner's row. Whether its session lookup hit the cache depends on timing, so the
        // session SELECT is counted apart: the ceiling is this count plus that one.
        int loser = both.stream().mapToInt(r -> (int) r.statements().stream().filter(q -> !q.contains("\"session\"")).count()).max().orElseThrow();
        assertThat(loser).isEqualTo(RACE_PATH_WITHOUT_SESSION);   // case, replay, supported_countries, upload lookup, status, insert, re-select
    }

    static final int RACE_PATH_WITHOUT_SESSION = 7;   // +1 for the session lookup on a cache miss = the ceiling, 8
}
