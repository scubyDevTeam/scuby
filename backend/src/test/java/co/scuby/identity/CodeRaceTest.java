package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.RecordingEmailSender;
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
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.IntFunction;

import static co.scuby.db.generated.Tables.CODE_SEND;
import static co.scuby.db.generated.Tables.EMAIL_CODE;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PHONE_OTP;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * The invariants that replaced the locks (docs/eng/backend.md · Concurrency): requests started together by a
 * barrier, every round, against a real pool. A code is consumed once; a code is issued once; the send caps may
 * be overshot by simultaneous requests, never by a later one.
 */
@IntegrationTest
@TestPropertySource(properties = {
        "spring.datasource.hikari.maximum-pool-size=10",
        "spring.datasource.hikari.minimum-idle=10",
        "spring.datasource.hikari.connection-timeout=5000"})
class CodeRaceTest {

    static final String PHONE = "+573009998877";
    static final int ROUNDS = 6;

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingEmailSender emails;
    @Autowired RecordingSmsSender sms;
    @Autowired DSLContext db;
    @Autowired co.scuby.support.MutableClock clock;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    /** Runs {@code n} tasks released together; returns their results in order. */
    private static <T> List<T> together(int n, IntFunction<Callable<T>> task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        try {
            CyclicBarrier go = new CyclicBarrier(n);
            List<Future<T>> futures = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                Callable<T> t = task.apply(i);
                futures.add(pool.submit(() -> { go.await(); return t.call(); }));
            }
            List<T> out = new ArrayList<>();
            for (Future<T> f : futures) out.add(f.get(30, TimeUnit.SECONDS));
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void anEmailCodeIsNeverConsumedTwice() throws Exception {
        for (int round = 0; round < ROUNDS; round++) {
            testDb.reset();
            emails.clear();
            String email = "ana" + round + "@correo.co";
            clients.newBrowser().post("/auth/email/start", "{\"email\":\"" + email + "\"}");
            String code = emails.lastCodeFor(email);
            List<ApiResponse> answers = together(6, i -> () -> clients.newBrowser().post("/auth/email/verify",
                    "{\"email\":\"" + email + "\",\"code\":\"" + code + "\"}"));
            assertThat(answers).extracting(ApiResponse::status).as("round %d", round)
                               .containsOnlyOnce(200).filteredOn(s -> s != 200).containsOnly(422);
            assertThat(db.fetchCount(PERSON)).isEqualTo(1);
            assertThat(db.fetchCount(co.scuby.db.generated.Tables.SESSION)).as("one session: one consumption").isEqualTo(1);
        }
    }

    @Test
    void aPhoneCodeIsNeverConsumedTwice() throws Exception {
        for (int round = 0; round < ROUNDS; round++) {
            testDb.reset();
            sms.clear();
            ApiClient owner = clients.newBrowser();
            accounts.signIn(owner, "ana" + round + "@correo.co");
            owner.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}");
            String code = sms.lastCodeFor(PHONE);
            String session = owner.cookie("__Host-session").orElseThrow();
            List<ApiResponse> answers = together(6, i -> () -> {
                ApiClient c = clients.newBrowser();
                c.setCookie("__Host-session", session);
                return c.post("/me/phone/verify", "{\"phone\":\"" + PHONE + "\",\"code\":\"" + code + "\"}");
            });
            assertThat(answers).extracting(ApiResponse::status).as("round %d", round)
                               .containsOnlyOnce(200).filteredOn(s -> s != 200).containsOnly(422);
            assertThat(db.fetchCount(PHONE_OTP)).as("the consumed code is gone").isZero();
        }
    }

    @Test
    void simultaneousEmailStartsForOneAddressIssueOneCode() throws Exception {
        for (int round = 0; round < ROUNDS; round++) {
            testDb.reset();
            emails.clear();
            List<ApiResponse> answers = together(5, i -> () -> clients.newBrowser().post("/auth/email/start", "{\"email\":\"ana@correo.co\"}"));
            assertThat(answers).extracting(ApiResponse::status).containsOnly(204);
            assertThat(emails.sent()).as("round %d: one code goes out inside the cooldown", round).hasSize(1);
            assertThat(db.fetchCount(EMAIL_CODE)).isEqualTo(1);
            assertThat(db.fetchCount(CODE_SEND)).isEqualTo(1);
        }
    }

    @Test
    void simultaneousSmsStartsFromOneAccountForOneNumberIssueOneCode() throws Exception {
        for (int round = 0; round < ROUNDS; round++) {
            testDb.reset();
            sms.clear();
            ApiClient owner = clients.newBrowser();
            accounts.signIn(owner, "ana@correo.co");
            String session = owner.cookie("__Host-session").orElseThrow();
            List<ApiResponse> answers = together(5, i -> () -> {
                ApiClient c = clients.newBrowser();
                c.setCookie("__Host-session", session);
                return c.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}");
            });
            assertThat(answers).extracting(ApiResponse::status).containsOnly(204);
            assertThat(sms.sent()).as("round %d", round).hasSize(1);
            assertThat(db.fetchCount(PHONE_OTP)).isEqualTo(1);
        }
    }

    /**
     * Thirty accounts ask for a code for one number at once. With no locks the cap and the cooldown are counted
     * before the insert, so simultaneous requests may all pass them (accepted overshoot: up to the number of
     * simultaneous requests). What must hold: no 5xx, every answered send is a logged send, and the cap holds
     * for every request that comes after the burst.
     */
    @Test
    void aBurstOfSendsToOneNumberMayOvershootTheCapButNeverBreaksItAfterwards() throws Exception {
        List<ApiResponse> answers = together(30, i -> () -> {
            ApiClient c = clients.newBrowser();
            accounts.signIn(c, "p" + i + "@correo.co");
            return c.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}");
        });
        assertThat(answers).extracting(ApiResponse::status).as("no 5xx, no 429 while nothing was logged yet").containsOnly(204);
        int burst = sms.sent().size();
        assertThat(burst).isBetween(1, 30);
        assertThat(db.fetchCount(CODE_SEND)).as("every SMS sent is logged").isEqualTo(burst);

        // After the burst the rule is exact again: nobody gets past the cap.
        clock.advance(java.time.Duration.ofSeconds(61));
        ApiClient late = clients.newBrowser();
        accounts.signIn(late, "late@correo.co");
        ApiResponse after = late.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}");
        if (burst >= 5) {
            assertThat(after.errorCode()).isEqualTo("rate_limited");
        } else {
            assertThat(after.status()).isEqualTo(204);
        }
    }
}
