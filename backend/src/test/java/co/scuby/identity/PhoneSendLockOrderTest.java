package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PublishBodies;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.PHONE_OTP;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * The SMS send path takes the person row first, like every other path that locks both rows (person, then
 * phone_otp). Before it did, two interleavings deadlocked:
 * (a) a publish (person row, then the send's advisory locks) against POST /me/phone (advisory locks, then the
 *     FK check of the new phone_otp row, which needs the person row);
 * (b) an email-code reclaim (person row, then DELETE of the phone_otp rows) against a resend (phone_otp row,
 *     then the send-log insert, whose FK needs the person row).
 * Each test holds one side mid-way with a latch, waits until the other side is blocked in the database, then
 * lets the first side go on: a deadlock aborts one of them after PostgreSQL's deadlock_timeout.
 */
@IntegrationTest
class PhoneSendLockOrderTest {

    static final String PHONE = "+573007152284";

    @Autowired PhoneOtp phoneOtp;
    @Autowired People people;
    @Autowired Accounts accounts;
    @Autowired TestDb testDb;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;
    @Autowired MutableClock clock;
    @Autowired ApiClients clients;
    @Autowired RecordingSmsSender sms;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    private Caller caller(UUID id) {
        return new Caller(id, "d".repeat(64));
    }

    private void awaitBlockedQuery() throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            Integer waiting = db.fetchOne("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database() and (query ilike '%person%' or query ilike '%phone_otp%' or query ilike '%code_send%')").get(0, Integer.class);
            if (waiting != null && waiting > 0) return;
            Thread.sleep(20);
        }
        throw new AssertionError("the second side never blocked: the interleaving was not exercised");
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(30, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void aPublishAndAPhoneStartOnOneAccountDoNotDeadlock() throws Exception {
        UUID ana = accounts.person("ana@correo.co");
        var pool = Executors.newFixedThreadPool(2);
        var holdsPerson = new CountDownLatch(1);
        var go = new CountDownLatch(1);
        try {
            // The publish: PublisherPhone.resolve locks the person row, then sends (advisory locks, upsert).
            Future<?> publish = pool.submit(() -> tx.executeWithoutResult(s -> {
                people.lock(ana);
                holdsPerson.countDown();
                await(go);
                phoneOtp.send(ana, PHONE, caller(ana));
            }));
            assertThat(holdsPerson.await(30, TimeUnit.SECONDS)).isTrue();
            Future<?> start = pool.submit(() -> tx.executeWithoutResult(s -> phoneOtp.send(ana, "+573001112233", caller(ana))));
            awaitBlockedQuery();
            go.countDown();
            publish.get(30, TimeUnit.SECONDS);       // a deadlock aborts one of the two
            start.get(30, TimeUnit.SECONDS);
            assertThat(db.fetchCount(PHONE_OTP)).isEqualTo(2);
        } finally {
            go.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void aReclaimAndAResendOnOneAccountDoNotDeadlock() throws Exception {
        UUID ana = accounts.person("ana@correo.co");
        tx.executeWithoutResult(s -> phoneOtp.send(ana, PHONE, caller(ana)));
        clock.advance(Duration.ofSeconds(61));          // out of the cooldown: the resend writes the row again

        var pool = Executors.newFixedThreadPool(2);
        var holdsPerson = new CountDownLatch(1);
        var go = new CountDownLatch(1);
        try {
            // The reclaim: person row (the unlink), then DELETE of its phone_otp rows.
            Future<?> reclaim = pool.submit(() -> tx.executeWithoutResult(s -> {
                people.lock(ana);
                holdsPerson.countDown();
                await(go);
                phoneOtp.discardAllOf(ana);
            }));
            assertThat(holdsPerson.await(30, TimeUnit.SECONDS)).isTrue();
            Future<?> resend = pool.submit(() -> tx.executeWithoutResult(s -> phoneOtp.send(ana, PHONE, caller(ana))));
            awaitBlockedQuery();
            go.countDown();
            reclaim.get(30, TimeUnit.SECONDS);
            resend.get(30, TimeUnit.SECONDS);
        } finally {
            go.countDown();
            pool.shutdownNow();
        }
    }

    /** The same race through HTTP, many rounds, started together by a barrier: neither request may answer 5xx. */
    @Test
    void publishRacingPhoneStartThroughHttpNeverAnswers5xx() throws Exception {
        var pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 15; round++) {
                ApiClient api = clients.newBrowser();
                accounts.signIn(api, "race" + round + "@correo.co");
                String phone = "+57300715" + String.format("%04d", round);
                var barrier = new CyclicBarrier(2);
                List<Future<ApiResponse>> results = new ArrayList<>();
                results.add(pool.submit(() -> { barrier.await(); return api.post("/lost-cases", PublishBodies.kira(phone, null)); }));
                results.add(pool.submit(() -> { barrier.await(); return api.post("/me/phone", "{\"phone\":\"" + phone + "\"}"); }));
                for (Future<ApiResponse> f : results) {
                    ApiResponse r = f.get(30, TimeUnit.SECONDS);
                    assertThat(r.status()).as("round %d: %s", round, r.body()).isLessThan(500);
                }
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
