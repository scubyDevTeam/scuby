package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.GoogleTestKeys;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PublishBodies;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import com.zaxxer.hikari.HikariDataSource;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static co.scuby.db.generated.Tables.CODE_SEND;
import static co.scuby.db.generated.Tables.PHONE_OTP;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Never hold a pooled connection during a network call (backend/CLAUDE.md). A code is stored and committed
 * first; the provider is called after the transaction returned its connection: no transaction is active, the
 * pool shows no active connection, and the committed row is visible to another connection. A failed send leaves
 * the stored code unused.
 */
@IntegrationTest
class NoConnectionDuringSendTest {

    static final String PHONE = "+573007152284";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingEmailSender emails;
    @Autowired RecordingSmsSender sms;
    @Autowired DataSource dataSource;
    @Autowired GoogleTestKeys keys;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    /** What the sender observes on the request thread. */
    private record Seen(boolean transactionActive, int activeConnections, int committedRows) {}

    private int activeConnections() {
        try {
            return dataSource.unwrap(HikariDataSource.class).getHikariPoolMXBean().getActiveConnections();
        } catch (java.sql.SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Counts rows as another connection sees them: only committed data is visible there. */
    private int committedRows(String table) throws Exception {
        ExecutorService other = Executors.newSingleThreadExecutor();
        try {
            Callable<Integer> count = () -> {
                try (Connection c = dataSource.getConnection(); var st = c.createStatement();
                     ResultSet rs = st.executeQuery("SELECT count(*) FROM scuby." + table)) {
                    rs.next();
                    return rs.getInt(1);
                }
            };
            return other.submit(count).get();
        } finally {
            other.shutdown();
        }
    }

    private Seen observe(String table) {
        try {
            boolean tx = TransactionSynchronizationManager.isActualTransactionActive();
            int active = activeConnections();                 // before the probe borrows a connection of its own
            return new Seen(tx, active, committedRows(table));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void theEmailCodeIsSentAfterTheCommitWithNoConnectionHeld() {
        AtomicReference<Seen> seen = new AtomicReference<>();
        emails.onSend(s -> seen.set(observe("email_code")));
        assertThat(clients.newBrowser().post("/auth/email/start", "{\"email\":\"ana@correo.co\"}").status()).isEqualTo(204);
        assertThat(emails.sent()).hasSize(1);
        assertThat(seen.get().transactionActive()).as("sender ran inside a transaction").isFalse();
        assertThat(seen.get().activeConnections()).as("pooled connections held during the send").isZero();
        assertThat(seen.get().committedRows()).as("email_code rows committed when the sender ran").isEqualTo(1);
    }

    @Test
    void theSmsOfPostMePhoneIsSentAfterTheCommitWithNoConnectionHeld() {
        ApiClient api = clients.newBrowser();
        accounts.signIn(api, "ana@correo.co");
        AtomicReference<Seen> seen = new AtomicReference<>();
        sms.onSend(s -> seen.set(observe("phone_otp")));
        assertThat(api.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}").status()).isEqualTo(204);
        assertThat(sms.sent()).hasSize(1);
        assertThat(seen.get().transactionActive()).as("sender ran inside a transaction").isFalse();
        assertThat(seen.get().activeConnections()).as("pooled connections held during the send").isZero();
        assertThat(seen.get().committedRows()).as("phone_otp rows committed when the sender ran").isEqualTo(1);
    }

    @Test
    void theSmsOfAPublishIsSentAfterTheCommitWithNoConnectionHeld() {
        ApiClient api = clients.newBrowser();
        accounts.signIn(api, "ana@correo.co");
        AtomicReference<Seen> seen = new AtomicReference<>();
        sms.onSend(s -> seen.set(observe("phone_otp")));
        var r = api.post("/lost-cases", PublishBodies.kira(PHONE, null));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/phone_step")).isEqualTo("otp");
        assertThat(sms.sent()).hasSize(1);
        assertThat(seen.get().transactionActive()).as("sender ran inside a transaction").isFalse();
        assertThat(seen.get().activeConnections()).as("pooled connections held during the send").isZero();
        assertThat(seen.get().committedRows()).as("phone_otp rows committed when the sender ran").isEqualTo(1);
    }

    @Test
    void aFailingSmsOnPostMePhoneIsAServerErrorAndLeavesTheCodeUnused() {
        ApiClient api = clients.newBrowser();
        accounts.signIn(api, "ana@correo.co");
        AtomicInteger calls = new AtomicInteger();
        sms.onSend(s -> { calls.incrementAndGet(); throw new IllegalStateException("provider down"); });
        var r = api.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}");
        assertThat(r.status()).isEqualTo(500);
        assertThat(r.str("/error/code")).isEqualTo("server_error");
        assertThat(calls.get()).isEqualTo(1);
        assertThat(db.select(PHONE_OTP.ATTEMPTS).from(PHONE_OTP).fetchOne().value1()).as("a stored, unused code").isZero();
        assertThat(db.fetchCount(CODE_SEND)).as("the send is counted").isEqualTo(1);
    }

    @Test
    void aFailingSmsOnAPublishIsAServerErrorAndLeavesTheCodeUnused() {
        ApiClient api = clients.newBrowser();
        accounts.signIn(api, "ana@correo.co");
        sms.onSend(s -> { throw new IllegalStateException("provider down"); });
        var r = api.post("/lost-cases", PublishBodies.kira(PHONE, null));
        assertThat(r.status()).isEqualTo(500);
        assertThat(r.str("/error/code")).isEqualTo("server_error");
        assertThat(db.select(PHONE_OTP.ATTEMPTS).from(PHONE_OTP).fetchOne().value1()).isZero();
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.LOST_CASE)).isZero();
    }

    @Test
    void aFailingEmailSenderStaysAServerError() {
        emails.onSend(s -> { throw new IllegalStateException("provider down"); });
        var r = clients.newBrowser().post("/auth/email/start", "{\"email\":\"ana@correo.co\"}");
        assertThat(r.status()).isEqualTo(500);
        assertThat(r.str("/error/code")).isEqualTo("server_error");
    }

    @Test
    void theGoogleKeySetIsNeverFetchedInsideATransactionOrWithAConnectionHeld() {
        AtomicReference<Boolean> inTransaction = new AtomicReference<>();
        AtomicInteger active = new AtomicInteger(-1);
        keys.onFetch(() -> {
            inTransaction.set(TransactionSynchronizationManager.isActualTransactionActive());
            active.set(activeConnections());
        });
        try {
            var r = clients.newBrowser().post("/auth/google",
                    "{\"credential\":\"" + keys.token(GoogleTestKeys.claims("sub-1", "carolina@gmail.com", clock.instant())) + "\"}");
            assertThat(r.status()).isEqualTo(200);
        } finally {
            keys.onFetch(() -> {});
        }
        assertThat(inTransaction.get()).as("a key fetch happened").isNotNull();
        assertThat(inTransaction.get()).as("the key fetch ran inside a transaction").isFalse();
        assertThat(active.get()).as("pooled connections held during the key fetch").isZero();
    }
}
