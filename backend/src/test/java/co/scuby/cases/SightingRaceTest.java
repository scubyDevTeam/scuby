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
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * «Lo vi» has no row locks: one conditional INSERT ... SELECT (the case must be active) with ON CONFLICT on the
 * replay key. The races it must survive are made deterministic by holding an uncommitted row from another
 * connection, or by a barrier.
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
    @Autowired SightingQueries queries;

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

    private void hold(String sql) throws Exception {
        holder = dataSource.getConnection();
        holder.setAutoCommit(false);
        try (PreparedStatement ps = holder.prepareStatement(sql)) {
            ps.execute();
        }
    }

    private static final String WAITING = "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()";

    private void waitUntilWaiting(int requests) throws Exception {
        for (int i = 0; i < 500; i++) {
            Integer waiting = db.fetchOne(WAITING).get(0, Integer.class);
            if (waiting == requests) return;
            Thread.sleep(20);
        }
        throw new AssertionError("the requests never queued (waiting: " + db.fetchOne(WAITING) + ")");
    }

    @Test
    void twoConcurrentSendsOfOneClientIdAreTheSameSightingAndOneRow() throws Exception {
        for (int round = 0; round < 8; round++) {
            testDb.reset();
            cases.luna(accounts.person("carolina" + round + "@correo.co"));
            String clientId = "queued-retry-" + round;
            var barrier = new CyclicBarrier(2);
            Callable<ApiResponse> send = () -> { barrier.await(); return clients.newBrowser().post("/cases/{code}/sightings",
                    body(",\"client_id\":\"" + clientId + "\""), "7K3PQ"); };
            Future<ApiResponse> a = pool.submit(send);
            Future<ApiResponse> b = pool.submit(send);
            ApiResponse ra = a.get(30, TimeUnit.SECONDS);
            ApiResponse rb = b.get(30, TimeUnit.SECONDS);
            assertThat(List.of(ra.status(), rb.status())).as("round %d", round).containsOnly(201);
            assertThat(ra.str("/id")).isEqualTo(rb.str("/id"));
            assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        }
    }

    /** A close that has not committed yet takes no lock the sighting needs: the sighting ordered before it, and is not delayed. */
    @Test
    void aCaseBeingClosedDoesNotDelayASighting() throws Exception {
        hold("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        Future<ApiResponse> f = pool.submit(() -> post(""));
        assertThat(f.get(10, TimeUnit.SECONDS).status()).isEqualTo(201);
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
    }

    /** The insert re-checks the status in its own statement: a case closed after the service read it takes no sighting. */
    @Test
    void theInsertItselfRefusesACaseThatIsNoLongerActive() {
        var caller = new co.scuby.platform.security.Caller(me, "d".repeat(64));
        var point = new co.scuby.platform.db.GeoPoint(6.2455, -75.5905);
        db.update(co.scuby.db.generated.Tables.LOST_CASE).set(co.scuby.db.generated.Tables.LOST_CASE.STATUS, "reunited").execute();
        assertThat(queries.insertIfActive("7K3PQ", point, clock.instant(), clock.instant(), null, List.of(), caller, null, "closed-1")).isEmpty();
        assertThat(queries.insertIfActive("NOPE0", point, clock.instant(), clock.instant(), null, List.of(), caller, null, null)).isEmpty();
        assertThat(db.fetchCount(SIGHTING)).isZero();
    }

    /**
     * Both passed the replay check; the second waits on the first's uncommitted row, hits ON CONFLICT and re-selects:
     * the longest path. The first is a raw uncommitted insert held by the test.
     */
    @Test
    void theLongestPathIsMeasuredExactlyOnTheConflictRaceWithPhotosAndAPhone() throws Exception {
        byte[] bytes = "race-photo".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        String url = api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        String extra = ",\"photo_urls\":[\"" + url + "\"],\"client_id\":\"long-path-1\"";
        hold("INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_device_hash, client_id) "
                + "VALUES ('00000000-0000-0000-0000-000000000001', '7K3PQ', 6.2455, -75.5905, now(), now(), repeat('a', 64), 'long-path-1')");
        caches.orderedStream().filter(c -> c.getClass().getSimpleName().equals("CachingSessionLookup")).forEach(ClearableCache::clear);   // the session lookup counts; the stored photo stays
        Future<ApiResponse> f = pool.submit(() -> api.post("/cases/{code}/sightings",
                body(extra).replace("\"contact_phone\":null", "\"contact_phone\":\"+573001112233\""), "7K3PQ"));
        waitUntilWaiting(1);
        holder.commit();
        holder.close();
        ApiResponse loser = f.get(30, TimeUnit.SECONDS);
        assertThat(loser.status()).isEqualTo(201);
        assertThat(loser.str("/id")).as("the winner's row").isEqualTo("00000000-0000-0000-0000-000000000001");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        // The session SELECT is counted apart (a cache hit depends on timing): the ceiling is this count plus that one.
        int withoutSession = (int) loser.statements().stream().filter(q -> !q.contains("\"session\"")).count();
        assertThat(withoutSession).isEqualTo(RACE_PATH_WITHOUT_SESSION);   // case, replay, supported_countries, upload lookup, insert (waits, conflicts), re-select
    }

    static final int RACE_PATH_WITHOUT_SESSION = 6;   // +1 for the session lookup on a cache miss = the ceiling, 7

    /**
     * The real longest path: a queued retry (client_id, phone, photo) whose case closes after the service read it.
     * The request is parked on supported_countries (an ACCESS EXCLUSIVE lock held by the test) after its case and
     * replay reads; the case is closed and committed; then the request goes on: the conditional insert is empty,
     * it re-selects the replay key, then reads the status, and answers 409. Eight statements with the session.
     */
    @Test
    void theLongestPathIsEightStatementsARetryWithPhoneAndPhotoOnACaseThatClosesMidRequest() throws Exception {
        byte[] bytes = "closing-photo".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        String url = api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        String extra = ",\"photo_urls\":[\"" + url + "\"],\"client_id\":\"closing-1\"";
        caches.orderedStream().filter(c -> c.getClass().getSimpleName().equals("CachingSessionLookup")).forEach(ClearableCache::clear);
        hold("LOCK TABLE scuby.supported_countries IN ACCESS EXCLUSIVE MODE");
        Future<ApiResponse> f = pool.submit(() -> api.post("/cases/{code}/sightings",
                body(extra).replace("\"contact_phone\":null", "\"contact_phone\":\"+573001112233\""), "7K3PQ"));
        waitUntilWaiting(1);
        db.update(co.scuby.db.generated.Tables.LOST_CASE).set(co.scuby.db.generated.Tables.LOST_CASE.STATUS, "reunited").execute();
        holder.commit();
        holder.close();
        ApiResponse refused = f.get(30, TimeUnit.SECONDS);
        assertThat(refused.status()).isEqualTo(409);
        assertThat(refused.errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(SIGHTING)).isZero();
        assertThat(refused.statements()).as("%s", refused.statements()).hasSize(CLOSING_PATH);
    }

    static final int CLOSING_PATH = 8;   // = the ceiling
}
