package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

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
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static org.assertj.core.api.Assertions.assertThat;

/** Answer races (no locks): two owner tabs flip a claim at once; the answer racing a closing of the case. Never a 500. */
@IntegrationTest
class ClaimAnswerRaceTest {

    static final String PATH = "/cases/{code}/claims/{claimId}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired co.scuby.support.TestDb testDb;

    ExecutorService pool = Executors.newFixedThreadPool(4);

    @AfterEach
    void tearDown() {
        pool.shutdownNow();
    }

    private static Callable<ApiResponse> together(CyclicBarrier barrier, Callable<ApiResponse> call) {
        return () -> { barrier.await(10, TimeUnit.SECONDS); return call.call(); };
    }

    private String status(UUID claim) {
        return db.select(RECOVERY_CLAIM.STATUS).from(RECOVERY_CLAIM).where(RECOVERY_CLAIM.ID.eq(claim)).fetchOne(RECOVERY_CLAIM.STATUS);
    }

    @Test
    void twoTabsFlippingTheSameClaimBothSucceedAndOneAnswerSticks() throws Exception {
        for (int n = 0; n < 10; n++) {
            testDb.reset();
            ApiClient tab1 = clients.newBrowser();
            UUID carolina = accounts.signIn(tab1, "carolina" + n + "@correo.co");
            ApiClient tab2 = clients.newBrowser();
            tab2.setCookie("__Host-session", tab1.cookie("__Host-session").orElseThrow());
            cases.luna(carolina);
            UUID claim = cases.claim("7K3PQ", accounts.person("andres" + n + "@correo.co"), "+573001112233",
                    MutableClock.START.minus(Duration.ofHours(2)), "open");
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> a = pool.submit(together(barrier, () -> tab1.post(PATH, "{\"status\":\"confirmed\"}", "7K3PQ", claim)));
            Future<ApiResponse> b = pool.submit(together(barrier, () -> tab2.post(PATH, "{\"status\":\"dismissed\"}", "7K3PQ", claim)));
            assertThat(List.of(a.get(30, TimeUnit.SECONDS).status(), b.get(30, TimeUnit.SECONDS).status())).as("round %d", n).containsOnly(200);
            assertThat(status(claim)).as("last writer wins").isIn("confirmed", "dismissed");
            assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
            assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).fetchOne(LOST_CASE.STATUS)).isEqualTo("active");
        }
    }

    @Test
    void twoIdenticalAnswersAtOnceBothSucceed() throws Exception {
        for (int n = 0; n < 6; n++) {
            testDb.reset();
            ApiClient tab1 = clients.newBrowser();
            UUID carolina = accounts.signIn(tab1, "carolina" + n + "@correo.co");
            ApiClient tab2 = clients.newBrowser();
            tab2.setCookie("__Host-session", tab1.cookie("__Host-session").orElseThrow());
            cases.luna(carolina);
            UUID claim = cases.claim("7K3PQ", accounts.person("andres" + n + "@correo.co"), "+573001112233",
                    MutableClock.START.minus(Duration.ofHours(2)), "open");
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> a = pool.submit(together(barrier, () -> tab1.post(PATH, "{\"status\":\"confirmed\"}", "7K3PQ", claim)));
            Future<ApiResponse> b = pool.submit(together(barrier, () -> tab2.post(PATH, "{\"status\":\"confirmed\"}", "7K3PQ", claim)));
            assertThat(List.of(a.get(30, TimeUnit.SECONDS).status(), b.get(30, TimeUnit.SECONDS).status())).as("round %d", n).containsOnly(200);
            assertThat(status(claim)).isEqualTo("confirmed");
        }
    }

    @Test
    void anAnswerRacingTheCaseBeingCancelledStillSucceeds() throws Exception {
        for (int n = 0; n < 6; n++) {
            testDb.reset();
            ApiClient owner = clients.newBrowser();
            UUID carolina = accounts.signIn(owner, "carolina" + n + "@correo.co");
            ApiClient tab2 = clients.newBrowser();
            tab2.setCookie("__Host-session", owner.cookie("__Host-session").orElseThrow());
            cases.luna(carolina);
            UUID claim = cases.claim("7K3PQ", accounts.person("andres" + n + "@correo.co"), "+573001112233",
                    MutableClock.START.minus(Duration.ofHours(2)), "open");
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> a = pool.submit(together(barrier, () -> owner.post(PATH, "{\"status\":\"confirmed\"}", "7K3PQ", claim)));
            Future<ApiResponse> b = pool.submit(together(barrier, () -> tab2.post("/cases/{code}/cancel", "{\"resolution\":\"duplicate\"}", "7K3PQ")));
            ApiResponse answered = a.get(30, TimeUnit.SECONDS);
            ApiResponse cancelled = b.get(30, TimeUnit.SECONDS);
            assertThat(answered.status()).as("round %d: %s", n, answered.body()).isEqualTo(200);
            assertThat(cancelled.status()).as("round %d: %s", n, cancelled.body()).isLessThan(500);
            assertThat(status(claim)).isEqualTo("confirmed");
        }
    }
}
