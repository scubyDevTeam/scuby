package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Closes and reopens take no application lock (decision #59): one conditional UPDATE each. The races of spec §7.2,
 * made deterministic with a held uncommitted row (Contention) or a barrier. Invariants, never lock order; never a 500.
 */
@IntegrationTest
class CaseLifecycleRaceTest {

    /** A signed-in «Lo vi» left uncommitted: it holds FOR KEY SHARE on the case row and on its reporter's person row. */
    static final String HELD_SIGHTING = "INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_device_hash, reporter_person_id) "
            + "VALUES (gen_random_uuid(), '7K3PQ', 6.2455, -75.5905, now(), now(), repeat('a', 64), ?)";
    static final String HELD_REUNITE = "UPDATE scuby.lost_case SET status = 'reunited', resolved_at = now(), resolution = 'reunited_home', "
            + "resolution_attribution = 'offline' WHERE code = '7K3PQ'";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    UUID carolina;
    Contention contention;
    ExecutorService pool = Executors.newFixedThreadPool(4);

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        cases.luna(carolina);
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
        pool.shutdownNow();
    }

    private ApiClient twinOf(ApiClient browser) {
        ApiClient twin = clients.newBrowser();
        twin.setCookie("__Host-session", browser.cookie("__Host-session").orElseThrow());
        return twin;
    }

    private String status() {
        return db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS);
    }

    private String attribution() {
        return db.select(LOST_CASE.RESOLUTION_ATTRIBUTION).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.RESOLUTION_ATTRIBUTION);
    }

    @Test
    void aReuniteNeverWaitsForAnUncommittedSightingAndTheSightingStays() throws Exception {
        contention.hold(HELD_SIGHTING, accounts.person("held@correo.co"));
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"offline\"}", "7K3PQ"));
        assertThat(f.get(10, TimeUnit.SECONDS).status()).isEqualTo(200);
        contention.commit();
        assertThat(status()).isEqualTo("reunited");
        assertThat(db.fetchCount(SIGHTING, SIGHTING.CASE_CODE.eq("7K3PQ"))).isEqualTo(1);
    }

    @Test
    void aCancelNeverWaitsForAnUncommittedSightingEither() throws Exception {
        contention.hold(HELD_SIGHTING, accounts.person("held@correo.co"));
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/cancel", "{\"resolution\":\"duplicate\"}", "7K3PQ"));
        assertThat(f.get(10, TimeUnit.SECONDS).status()).isEqualTo(200);
        contention.commit();
        assertThat(status()).isEqualTo("cancelled");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
    }

    @Test
    void aSightingCommittedBeforeTheCloseStaysAndOneAfterItIsRefused() {
        ApiClient helper = clients.newBrowser();
        accounts.signIn(helper, "helper@correo.co");
        String body = "{\"point\":{\"lat\":6.2455,\"lng\":-75.5905},\"seen_at\":\"" + MutableClock.START + "\",\"note\":null,\"contact_phone\":null}";
        assertThat(helper.post("/cases/{code}/sightings", body, "7K3PQ").status()).isEqualTo(201);
        assertThat(owner.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"platform_sighting\"}", "7K3PQ").status()).isEqualTo(200);
        ApiResponse late = helper.post("/cases/{code}/sightings", body, "7K3PQ");
        assertThat(late.status()).isEqualTo(409);
        assertThat(late.errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        assertThat(owner.get("/cases/{code}", "7K3PQ").json().get("sightings")).hasSize(1);
    }

    @Test
    void aReuniteAndACancelAtOnceCloseTheCaseExactlyOnce() throws Exception {
        for (int round = 0; round < 6; round++) {
            testDb.reset();
            owner = clients.newBrowser();
            carolina = accounts.signIn(owner, "carolina" + round + "@correo.co");
            cases.luna(carolina);
            ApiClient a = owner;
            ApiClient b = twinOf(owner);
            var barrier = new CyclicBarrier(2);
            Callable<ApiResponse> reunite = () -> { barrier.await(10, TimeUnit.SECONDS);
                return a.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"offline\"}", "7K3PQ"); };
            Callable<ApiResponse> cancel = () -> { barrier.await(10, TimeUnit.SECONDS);
                return b.post("/cases/{code}/cancel", "{\"resolution\":\"duplicate\"}", "7K3PQ"); };
            Future<ApiResponse> fr = pool.submit(reunite);
            Future<ApiResponse> fc = pool.submit(cancel);
            ApiResponse rr = fr.get(30, TimeUnit.SECONDS);
            ApiResponse rc = fc.get(30, TimeUnit.SECONDS);
            assertThat(List.of(rr.status(), rc.status())).as("round %d", round).containsExactlyInAnyOrder(200, 409);
            ApiResponse loser = rr.status() == 409 ? rr : rc;
            assertThat(loser.errorCode()).isEqualTo("invalid_transition");
            assertThat(status()).isEqualTo(rr.status() == 200 ? "reunited" : "cancelled");
        }
    }

    /**
     * Deterministic close against close: a reunite is held uncommitted; the cancel passes its pre-read (active), its UPDATE
     * waits on the row, re-checks status = 'active' after the commit, matches nothing, and its re-read finds `reunited`, a
     * different state from its own target: invalid_transition. The longest path: session, pre-read, UPDATE, re-read = 4.
     */
    @Test
    void aCancelThatMeetsACommittedReuniteIsInvalidTransitionOnTheLongestPath() throws Exception {
        contention.hold(HELD_REUNITE);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/cancel", "{\"resolution\":\"duplicate\"}", "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(status()).isEqualTo("reunited");
        assertThat(attribution()).isEqualTo("offline");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }

    /** A retried reunite that meets the first one in flight: 200, and the first call's attribution stays. */
    @Test
    void aRetriedReuniteThatMeetsTheFirstOneAnswersOkAndKeepsItsAttribution() throws Exception {
        contention.hold(HELD_REUNITE);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"unknown\"}", "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        assertThat(attribution()).as("never overwritten by the retry").isEqualTo("offline");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }

    /**
     * The owner's reopen against a claim's reactivation of the same expired case (the reactivation is the reopen UPDATE
     * without the owner guard, held uncommitted here): the reopen's UPDATE waits, re-checks status = 'expired' after the
     * commit, matches nothing, and its re-read finds the case active — what the owner asked for. Both end active: 200.
     */
    @Test
    void aReopenThatMeetsAClaimsReactivationAnswersOkAndTheCaseIsActive() throws Exception {
        cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(2)));
        contention.hold("UPDATE scuby.lost_case SET status = 'active', resolution = NULL, resolution_attribution = NULL, resolved_at = NULL "
                + "WHERE code = '7K3PQ'");
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/reopen", null, "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        assertThat(status()).isEqualTo("active");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }

    /**
     * The reopen passes its pre-read (the rival's active case is not committed), its UPDATE waits on the rival's entry in
     * lost_case_one_active_per_pet, the rival commits, the UPDATE fails on the unique index: active_case_exists naming the
     * rival, never a 500. The longest reopen path: session, pre-read, update, active-code read = the ceiling, 4.
     */
    @Test
    void aReopenThatLosesToAnUncommittedPublishOfTheSamePetIsActiveCaseExists() throws Exception {
        cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(2)));
        UUID pet = cases.petOf("7K3PQ");
        contention.hold("INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, contact_phone, contact_phone_verified, "
                + "phone_has_whatsapp, expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_public_lat, "
                + "last_seen_public_lng, last_seen_radius_m, last_seen_at) VALUES ('RIVAL', ?, ?, 'active', now(), '+573114829017', true, "
                + "true, true, false, false, 6.2442, -75.5812, 6.2442, -75.580392, 300, now())", pet, carolina);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/reopen", null, "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("RIVAL");
        assertThat(status()).isEqualTo("expired");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }
}
