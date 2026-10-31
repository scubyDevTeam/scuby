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
 * Requests that overlap in time, made deterministic: the test holds the reporter's advisory lock, lets the
 * requests pile up behind it (each has passed every check outside the transaction), then releases it.
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

    private void holdTheReporterLock() throws Exception {
        holder = dataSource.getConnection();
        holder.setAutoCommit(false);
        try (PreparedStatement ps = holder.prepareStatement("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")) {
            ps.setString(1, "sighting-reporter:p:" + me);
            ps.execute();
        }
    }

    private void waitUntilWaiting(int requests) throws Exception {
        for (int i = 0; i < 500; i++) {
            Integer waiting = db.fetchOne("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted").get(0, Integer.class);
            if (waiting == requests) return;
            Thread.sleep(20);
        }
        throw new AssertionError("the requests never queued behind the lock (waiting: " + db.fetchOne("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted") + ")");
    }

    private void release() throws Exception {
        holder.commit();
        holder.close();
    }

    private List<ApiResponse> concurrently(List<Callable<ApiResponse>> calls) throws Exception {
        List<Future<ApiResponse>> futures = calls.stream().map(pool::submit).toList();
        try { waitUntilWaiting(calls.size()); } catch (AssertionError e) {
            for (var f : futures) if (f.isDone()) { try { System.out.println("EARLY: " + f.get().status() + " " + f.get().body()); } catch (Exception x) { x.printStackTrace(); } }
            throw e;
        }
        release();
        return futures.stream().map(f -> {
            try { return f.get(30, TimeUnit.SECONDS); } catch (Exception e) { throw new AssertionError(e); }
        }).toList();
    }

    @Test
    void aRetryThatQueuedBehindItsOriginalAtTheLimitGetsTheStoredIdNotRateLimited() throws Exception {
        for (int i = 0; i < 4; i++) assertThat(post("").status()).isEqualTo(201);
        holdTheReporterLock();
        Callable<ApiResponse> send = () -> post(",\"client_id\":\"fifth-retry-1\"");
        List<ApiResponse> both = concurrently(List.of(send, send));
        assertThat(both).extracting(ApiResponse::status).containsExactly(201, 201);
        assertThat(both.get(0).str("/id")).isEqualTo(both.get(1).str("/id"));
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(5);
    }

    @Test
    void aRetryAtTheLimitAfterTheOriginalCommittedIsTheStoredIdNotRateLimited() {
        for (int i = 0; i < 4; i++) assertThat(post("").status()).isEqualTo(201);
        String first = post(",\"client_id\":\"fifth-retry-2\"").str("/id");
        ApiResponse retry = post(",\"client_id\":\"fifth-retry-2\"");
        assertThat(retry.status()).isEqualTo(201);
        assertThat(retry.str("/id")).isEqualTo(first);
        assertThat(post("").errorCode()).isEqualTo("rate_limited");   // a new send at the limit is still refused
    }

    @Test
    void aCaseClosedWhileTheRequestWaitedForTheLockIsRefused() throws Exception {
        holdTheReporterLock();
        Future<ApiResponse> f = pool.submit(() -> post(""));
        waitUntilWaiting(1);
        db.execute("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        release();
        assertThat(f.get(30, TimeUnit.SECONDS).errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(SIGHTING)).isZero();
    }

    /** Both passed the replay check, both counted below the limit; the second hits ON CONFLICT and re-selects: the longest path. */
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
        holdTheReporterLock();
        caches.orderedStream().filter(c -> c.getClass().getSimpleName().equals("CachingSessionLookup")).forEach(ClearableCache::clear);   // the session lookup counts; the stored photo stays
        List<ApiResponse> both = concurrently(List.of(send, send));
        assertThat(both).extracting(ApiResponse::status).containsExactly(201, 201);
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        // The loser re-selects the winner's row. Whether its session lookup hit the cache depends on timing, so the
        // session SELECT is counted apart: the ceiling is this count plus that one.
        int loser = both.stream().mapToInt(r -> (int) r.statements().stream().filter(q -> !q.contains("\"session\"")).count()).max().orElseThrow();
        assertThat(loser).isEqualTo(RACE_PATH_WITHOUT_SESSION);   // case, replay, supported_countries, upload lookup, 2 locks, status, 2 counts, insert, re-select
    }

    static final int RACE_PATH_WITHOUT_SESSION = 11;   // +1 for the session lookup on a cache miss = the ceiling, 12
}
