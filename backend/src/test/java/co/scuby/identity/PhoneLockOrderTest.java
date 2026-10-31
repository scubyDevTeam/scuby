package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.support.Accounts;
import co.scuby.support.IntegrationTest;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Lock order is person row, then phone_otp row, everywhere. An email-code reclaim UPDATEs the person (the unlink)
 * and then deletes its phone_otp rows; a phone verify that took them the other way round deadlocked with it.
 */
@IntegrationTest
class PhoneLockOrderTest {

    static final String PHONE = "+573007152284";

    @Autowired PhoneChange phoneChange;
    @Autowired PhoneOtp phoneOtp;
    @Autowired People people;
    @Autowired Accounts accounts;
    @Autowired TestDb testDb;
    @Autowired RecordingSmsSender sms;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    @Test
    void aPhoneVerifyRacingAReclaimNeitherDeadlocksNorKeepsTheNumber() throws Exception {
        UUID ana = accounts.person("ana@correo.co");
        tx.executeWithoutResult(s -> phoneOtp.send(ana, PHONE, new Caller(ana, "d".repeat(64))));
        String code = sms.lastCodeFor(PHONE);

        var pool = Executors.newFixedThreadPool(2);
        var holdsPerson = new CountDownLatch(1);
        var go = new CountDownLatch(1);
        try {
            // The reclaim: person row first (the unlink), phone_otp second (discardAllOf), then commit.
            Future<?> reclaim = pool.submit(() -> tx.executeWithoutResult(s -> {
                people.lock(ana);
                holdsPerson.countDown();
                await(go);
                phoneOtp.discardAllOf(ana);
            }));
            assertThat(holdsPerson.await(30, TimeUnit.SECONDS)).isTrue();
            Future<?> verify = pool.submit(() -> phoneChange.verify(ana, PHONE, code));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            while (System.nanoTime() < deadline) {                       // the verify is waiting for the reclaim
                Integer waiting = db.fetchOne("select count(*) from pg_stat_activity where wait_event_type = 'Lock'").get(0, Integer.class);
                if (waiting != null && waiting > 0) break;
                Thread.sleep(20);
            }
            go.countDown();

            reclaim.get(30, TimeUnit.SECONDS);                           // a deadlock would abort one of the two
            assertThatThrownBy(() -> verify.get(30, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .cause().isInstanceOfSatisfying(ApiException.class,
                            e -> assertThat(e.getBody().getProperties().get("code")).isEqualTo("invalid_code"));
            assertThat(people.get(ana).phone()).isNull();
        } finally {
            go.countDown();
            pool.shutdownNow();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(30, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }
}
