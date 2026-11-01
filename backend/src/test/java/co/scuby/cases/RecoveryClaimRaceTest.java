package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PublishBodies;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static org.assertj.core.api.Assertions.assertThat;

/** The claim races of spec §7.2: invariants under a barrier or a held row; never a 500. */
@IntegrationTest
class RecoveryClaimRaceTest {

    static final String PATH = "/cases/{code}/recovery-claims";
    static final String BODY = "{\"phone\":\"+573001112233\"}";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;

    ExecutorService pool = Executors.newFixedThreadPool(4);
    Contention contention;
    ApiClient owner;
    UUID carolina;

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
        pool.shutdownNow();
    }

    /** A fresh round: Luna, expired two days ago unless {@code active}. */
    private void round(int n, boolean active) {
        testDb.reset();
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina" + n + "@correo.co");
        cases.luna(carolina);
        if (!active) cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(2)));
    }

    private ApiClient signedIn(String email) {
        ApiClient c = clients.newBrowser();
        accounts.signIn(c, email);
        return c;
    }

    private ApiClient twinOf(ApiClient browser) {
        ApiClient twin = clients.newBrowser();
        twin.setCookie("__Host-session", browser.cookie("__Host-session").orElseThrow());
        return twin;
    }

    private static Callable<ApiResponse> together(CyclicBarrier barrier, Callable<ApiResponse> call) {
        return () -> { barrier.await(10, TimeUnit.SECONDS); return call.call(); };
    }

    private long activeCasesOf(UUID pet) {
        return db.fetchCount(LOST_CASE, LOST_CASE.PET_ID.eq(pet).and(LOST_CASE.STATUS.eq("active")));
    }

    @Test
    void theSamePersonClaimingTwiceAtOnceGetsOneRowAndItsIdTwice() throws Exception {
        for (int n = 0; n < 8; n++) {
            round(n, true);
            ApiClient a = signedIn("andres" + n + "@correo.co");
            ApiClient b = twinOf(a);
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> fa = pool.submit(together(barrier, () -> a.post(PATH, BODY, "7K3PQ")));
            Future<ApiResponse> fb = pool.submit(together(barrier, () -> b.post(PATH, "{\"phone\":\"+573009998877\"}", "7K3PQ")));
            ApiResponse ra = fa.get(30, TimeUnit.SECONDS);
            ApiResponse rb = fb.get(30, TimeUnit.SECONDS);
            assertThat(List.of(ra.status(), rb.status())).as("round %d", n).containsOnly(201);
            assertThat(ra.str("/id")).isEqualTo(rb.str("/id"));
            assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
            assertThat(db.select(RECOVERY_CLAIM.PHONE).from(RECOVERY_CLAIM).fetchOne(RECOVERY_CLAIM.PHONE))
                    .as("the later of the two writes").isIn("+573001112233", "+573009998877");
        }
    }

    /**
     * Deterministic double tap: the first «Lo tengo» is held uncommitted; the second's upsert waits on the first's entry in
     * recovery_claim_one_open_per_claimant, then takes the DO UPDATE branch on the committed row: one row, the same id, the
     * second tap's phone, never a 500.
     */
    @Test
    void aSecondTapThatMeetsTheFirstInFlightRefreshesTheSameRow() throws Exception {
        round(0, true);
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID first = UUID.randomUUID();
        contention.hold("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at) "
                + "VALUES (?, '7K3PQ', ?, '+573001112233', 'open', now(), now())", first, andres);
        Future<ApiResponse> f = pool.submit(() -> helper.post(PATH, "{\"phone\":\"+573009998877\"}", "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/id")).isEqualTo(first.toString());
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
        assertThat(db.select(RECOVERY_CLAIM.PHONE).from(RECOVERY_CLAIM).fetchOne(RECOVERY_CLAIM.PHONE)).isEqualTo("+573009998877");
    }

    @Test
    void twoClaimantsOnOneExpiredCaseReactivateItOnceAndBothClaimsAreStored() throws Exception {
        for (int n = 0; n < 8; n++) {
            round(n, false);
            ApiClient a = signedIn("andres" + n + "@correo.co");
            ApiClient b = signedIn("laura" + n + "@correo.co");
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> fa = pool.submit(together(barrier, () -> a.post(PATH, BODY, "7K3PQ")));
            Future<ApiResponse> fb = pool.submit(together(barrier, () -> b.post(PATH, BODY, "7K3PQ")));
            assertThat(List.of(fa.get(30, TimeUnit.SECONDS).status(), fb.get(30, TimeUnit.SECONDS).status())).as("round %d", n).containsOnly(201);
            assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(2);
            assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS)).isEqualTo("active");
            assertThat(activeCasesOf(cases.petOf("7K3PQ"))).isEqualTo(1);
        }
    }

    @Test
    void aClaimAgainstAPublishForTheSamePetLeavesExactlyOneActiveCase() throws Exception {
        for (int n = 0; n < 6; n++) {
            round(n, false);
            UUID pet = cases.petOf("7K3PQ");
            db.update(PERSON).set(PERSON.PHONE, "+573114829017")
              .set(PERSON.PHONE_VERIFIED_AT, MutableClock.START.atOffset(ZoneOffset.UTC)).where(PERSON.ID.eq(carolina)).execute();
            ApiClient helper = signedIn("andres" + n + "@correo.co");
            var barrier = new CyclicBarrier(2);
            ApiClient publisher = owner;
            Future<ApiResponse> fp = pool.submit(together(barrier, () -> publisher.post("/lost-cases", PublishBodies.withPetId(pet.toString(), null))));
            Future<ApiResponse> fc = pool.submit(together(barrier, () -> helper.post(PATH, BODY, "7K3PQ")));
            ApiResponse published = fp.get(30, TimeUnit.SECONDS);
            ApiResponse claimed = fc.get(30, TimeUnit.SECONDS);
            assertThat(activeCasesOf(pet)).as("round %d", n).isEqualTo(1);
            assertThat(published.status() == 200).as("exactly one of them wins (round %d): %s / %s", n, published.body(), claimed.body())
                    .isNotEqualTo(claimed.status() == 201);
            ApiResponse loser = published.status() == 200 ? claimed : published;
            assertThat(loser.status()).isEqualTo(409);
            assertThat(loser.errorCode()).isEqualTo("active_case_exists");
        }
    }

    @Test
    void aClaimAgainstTheOwnersReopenEndsActiveWithTheClaimStored() throws Exception {
        for (int n = 0; n < 6; n++) {
            round(n, false);
            ApiClient helper = signedIn("andres" + n + "@correo.co");
            ApiClient reopener = owner;
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> fr = pool.submit(together(barrier, () -> reopener.post("/cases/{code}/reopen", null, "7K3PQ")));
            Future<ApiResponse> fc = pool.submit(together(barrier, () -> helper.post(PATH, BODY, "7K3PQ")));
            ApiResponse reopened = fr.get(30, TimeUnit.SECONDS);
            ApiResponse claimed = fc.get(30, TimeUnit.SECONDS);
            assertThat(claimed.status()).as("round %d: %s", n, claimed.body()).isEqualTo(201);
            // Reopen is idempotent: whoever made the case active first, the owner asked for active and got it.
            assertThat(reopened.status()).as("round %d: %s", n, reopened.body()).isEqualTo(200);
            assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
            assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS)).isEqualTo("active");
        }
    }

    /** Deterministic: the reactivation waits on an uncommitted publish's index entry, then fails on it: 409, no claim, never a 500. */
    @Test
    void aReactivationThatLosesToAnUncommittedPublishIsActiveCaseExistsAndStoresNoClaim() throws Exception {
        round(0, false);
        UUID pet = cases.petOf("7K3PQ");
        ApiClient helper = signedIn("andres@correo.co");
        contention.hold("INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, contact_phone, contact_phone_verified, "
                + "phone_has_whatsapp, expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_public_lat, "
                + "last_seen_public_lng, last_seen_radius_m, last_seen_at) VALUES ('RIVAL', ?, ?, 'active', now(), '+573114829017', true, "
                + "true, true, false, false, 6.2442, -75.5812, 6.2442, -75.580392, 300, now())", pet, carolina);
        Future<ApiResponse> f = pool.submit(() -> helper.post(PATH, BODY, "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("RIVAL");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
        assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS)).isEqualTo("expired");
    }
}
