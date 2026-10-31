package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.IntFunction;

import static co.scuby.db.generated.Tables.CODE_SEND;
import static co.scuby.db.generated.Tables.PHONE_OTP;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Parallel load against a real pool of 10 connections. The short connection timeout turns a stalled pool
 * into a visible 500 within seconds instead of a 30 s hang.
 */
@IntegrationTest
@TestPropertySource(properties = {
        "spring.datasource.hikari.maximum-pool-size=10",
        "spring.datasource.hikari.minimum-idle=10",
        "spring.datasource.hikari.connection-timeout=2000"})
class PhoneConcurrencyTest {

    static final String PHONE = "+573009998877";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingSmsSender sms;
    @Autowired DSLContext db;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    /** Runs {@code n} tasks released together; returns their results in order. */
    private static <T> List<T> burst(int n, IntFunction<Callable<T>> task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<T>> futures = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                Callable<T> t = task.apply(i);
                futures.add(pool.submit(() -> { go.await(); return t.call(); }));
            }
            go.countDown();
            List<T> out = new ArrayList<>();
            for (Future<T> f : futures) out.add(f.get(30, TimeUnit.SECONDS));
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void fifteenParallelWrongCodesAllAnswerFastAndTheCapHolds() throws Exception {
        ApiClient owner = clients.newBrowser();
        accounts.signIn(owner, "carolina@correo.co");
        owner.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}");
        String code = sms.lastCodeFor(PHONE);
        String wrong = code.equals("000000") ? "111111" : "000000";
        String session = owner.cookie("__Host-session").orElseThrow();

        long start = System.nanoTime();
        List<ApiResponse> answers = burst(15, i -> () -> {
            ApiClient c = clients.newBrowser();
            c.setCookie("__Host-session", session);
            return c.post("/me/phone/verify", "{\"phone\":\"" + PHONE + "\",\"code\":\"" + wrong + "\"}");
        });
        long millis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

        assertThat(answers).extracting(ApiResponse::status).as("no 500 from a starved pool").doesNotContain(500)
                           .allMatch(s -> s == 422);
        assertThat(answers).extracting(ApiResponse::errorCode).containsOnly("invalid_code");
        assertThat(millis).as("all answered without waiting for a connection").isLessThan(8_000);
        assertThat(db.select(PHONE_OTP.ATTEMPTS).from(PHONE_OTP).fetchOne().value1()).isEqualTo(3);
        // The code is burnt: the right one no longer works.
        assertThat(owner.post("/me/phone/verify", "{\"phone\":\"" + PHONE + "\",\"code\":\"" + code + "\"}").errorCode())
                .isEqualTo("invalid_code");
    }

    /** Thirty accounts ask for a code for one number at once: only the advisory lock keeps the count at the cap of 5. */
    @Test
    void aParallelBurstOfSendsToOneNumberStopsAtTheNumberCap() throws Exception {
        List<ApiResponse> answers = burst(30, i -> () -> {
            ApiClient c = clients.newBrowser();
            accounts.signIn(c, "p" + i + "@correo.co");
            return c.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}");
        });
        assertThat(answers).filteredOn(r -> r.status() == 204).hasSize(5);
        assertThat(answers).filteredOn(r -> r.status() == 429).hasSize(25);
        assertThat(db.fetchCount(CODE_SEND)).isEqualTo(5);
    }
}
