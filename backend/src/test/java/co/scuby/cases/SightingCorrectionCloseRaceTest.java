package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;

/**
 * A correction racing a case close (reunite or cancel). Whatever the interleaving, the correction either applies while
 * the case is still active or answers invalid_transition: it never applies to a closed case. The close takes no lock on
 * the pin, so the only barrier is the correction UPDATE's own EXISTS (case is active) guard and the re-read behind it.
 */
@IntegrationTest
class SightingCorrectionCloseRaceTest {

    static final Instant CREATED = MutableClock.START.minus(Duration.ofMinutes(5));
    static final String PATH = "/cases/{code}/sightings/{sightingId}/correction";
    static final String GOOD = "{\"point\":{\"lat\":6.25,\"lng\":-75.59},\"seen_at\":\"2026-10-14T16:50:00Z\",\"note\":\"En la esquina\"}";
    static final String REUNITE = "/cases/{code}/reunite";
    static final String CANCEL = "/cases/{code}/cancel";
    static final String REUNITE_BODY = "{\"resolution_attribution\":\"offline\"}";
    static final String CANCEL_BODY = "{\"resolution\":\"duplicate\"}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @MockitoSpyBean SightingQueries queries;

    ApiClient owner;
    ApiClient reporter;
    UUID pin;
    ExecutorService pool = Executors.newFixedThreadPool(2);

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        cases.luna(accounts.signIn(owner, "carolina@correo.co"));
        reporter = clients.newBrowser();
        reporter.get("/config");
        String device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, null, device, null, "visible");
        db.update(SIGHTING).set(SIGHTING.NOTE, "Corría").where(SIGHTING.ID.eq(pin)).execute();
    }

    @AfterEach
    void tearDown() {
        pool.shutdownNow();
    }

    private String caseStatus() {
        return db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS);
    }

    private String note() {
        return db.select(SIGHTING.NOTE).from(SIGHTING).where(SIGHTING.ID.eq(pin)).fetchOne(SIGHTING.NOTE);
    }

    /**
     * The close commits after the correction's pre-read passed and before its UPDATE starts: only the UPDATE's EXISTS
     * guard can stop it, and the re-read must answer invalid_transition. Ordered by latches, never by sleeps.
     */
    @ParameterizedTest
    @CsvSource({"reunited," + REUNITE, "cancelled," + CANCEL})
    void aCloseCommittedBetweenThePreReadAndTheUpdateIsInvalidTransitionAndNothingIsWritten(String closed, String closePath) throws Exception {
        CountDownLatch preReadPassed = new CountDownLatch(1);
        CountDownLatch caseClosed = new CountDownLatch(1);
        doAnswer(call -> {
            preReadPassed.countDown();
            assertThat(caseClosed.await(30, TimeUnit.SECONDS)).as("the close commits while the correction waits").isTrue();
            return call.callRealMethod();
        }).when(queries).correct(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());

        Future<ApiResponse> correction = pool.submit(() -> reporter.post(PATH, GOOD, "7K3PQ", pin));
        assertThat(preReadPassed.await(30, TimeUnit.SECONDS)).isTrue();
        ApiResponse close = owner.post(closePath, closePath.equals(REUNITE) ? REUNITE_BODY : CANCEL_BODY, "7K3PQ");
        assertThat(close.status()).isEqualTo(200);
        caseClosed.countDown();

        ApiResponse r = correction.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(note()).as("a closed case's pin is not corrected").isEqualTo("Corría");
        assertThat(caseStatus()).isEqualTo(closed);
    }

    /** No hooks: both requests released together. Either order is fine, but a 204 means the pin changed and a 409 means it did not. */
    @ParameterizedTest
    @CsvSource({"reunited," + REUNITE, "cancelled," + CANCEL})
    void freeRunningCorrectionAndCloseNeverCorruptTheInvariant(String closed, String closePath) throws Exception {
        CyclicBarrier go = new CyclicBarrier(2);
        Future<ApiResponse> correction = pool.submit(() -> { go.await(10, TimeUnit.SECONDS); return reporter.post(PATH, GOOD, "7K3PQ", pin); });
        Future<ApiResponse> close = pool.submit(() -> { go.await(10, TimeUnit.SECONDS);
            return owner.post(closePath, closePath.equals(REUNITE) ? REUNITE_BODY : CANCEL_BODY, "7K3PQ"); });

        assertThat(close.get(30, TimeUnit.SECONDS).status()).isEqualTo(200);
        ApiResponse r = correction.get(30, TimeUnit.SECONDS);
        assertThat(caseStatus()).isEqualTo(closed);
        assertThat(r.status()).isIn(204, 409);
        if (r.status() == 204) {
            assertThat(note()).isEqualTo("En la esquina");
        } else {
            assertThat(r.errorCode()).isEqualTo("invalid_transition");
            assertThat(note()).isEqualTo("Corría");
        }
        // After the close has committed, a correction can only be refused.
        ApiResponse late = reporter.post(PATH, GOOD.replace("En la esquina", "Tarde"), "7K3PQ", pin);
        assertThat(late.errorCode()).isEqualTo("invalid_transition");
        assertThat(note()).isNotEqualTo("Tarde");
    }
}
