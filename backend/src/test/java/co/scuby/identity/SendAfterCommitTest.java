package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClients;
import co.scuby.support.GoogleTestKeys;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * No network call inside a database transaction (design rule): a provider call holds locks and a pooled
 * connection for as long as it takes, and a rollback after it would leave a code nobody can use. The sender
 * runs only once the code row is committed (visible to another connection), and not at all on a rollback.
 */
@IntegrationTest
class SendAfterCommitTest {

    static final String PHONE = "+573007152284";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingEmailSender emails;
    @Autowired RecordingSmsSender sms;
    @Autowired PhoneOtp phoneOtp;
    @Autowired TransactionTemplate tx;
    @Autowired DataSource dataSource;
    @Autowired GoogleTestKeys keys;
    @Autowired MutableClock clock;

    final Caller caller = new Caller(null, "d".repeat(64), "i".repeat(64));

    @BeforeEach
    void setUp() {
        testDb.reset();
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

    @Test
    void theEmailCodeIsSentOnlyAfterItIsCommitted() {
        AtomicReference<Integer> committedAtSend = new AtomicReference<>();
        AtomicBoolean inTransaction = new AtomicBoolean(true);
        emails.onSend(s -> {
            inTransaction.set(TransactionSynchronizationManager.isActualTransactionActive());
            try { committedAtSend.set(committedRows("email_code")); } catch (Exception e) { throw new IllegalStateException(e); }
        });
        assertThat(clients.newBrowser().post("/auth/email/start", "{\"email\":\"ana@correo.co\"}").status()).isEqualTo(204);
        assertThat(emails.sent()).hasSize(1);
        assertThat(committedAtSend.get()).as("email_code rows committed when the sender ran").isEqualTo(1);
        assertThat(inTransaction.get()).as("sender ran inside a transaction").isFalse();
    }

    @Test
    void theSmsCodeIsSentOnlyAfterTheEnclosingTransactionCommits() {
        UUID ana = accounts.person("ana@correo.co");
        AtomicReference<Integer> committedAtSend = new AtomicReference<>();
        sms.onSend(s -> {
            try { committedAtSend.set(committedRows("phone_otp")); } catch (Exception e) { throw new IllegalStateException(e); }
        });
        tx.executeWithoutResult(status -> {
            phoneOtp.send(ana, PHONE, caller);
            assertThat(sms.sent()).as("nothing is sent before the commit").isEmpty();
        });
        assertThat(sms.sent()).hasSize(1);
        assertThat(committedAtSend.get()).as("phone_otp rows committed when the sender ran").isEqualTo(1);
    }

    @Test
    void aRolledBackTransactionSendsNothing() {
        UUID ana = accounts.person("ana@correo.co");
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            phoneOtp.send(ana, PHONE, caller);
            throw new IllegalStateException("the publish failed after the code was stored");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(sms.sent()).isEmpty();
    }

    @Test
    void theGoogleKeySetIsNeverFetchedInsideATransaction() {
        AtomicReference<Boolean> inTransaction = new AtomicReference<>();
        keys.onFetch(() -> inTransaction.set(TransactionSynchronizationManager.isActualTransactionActive()));
        try {
            var r = clients.newBrowser().post("/auth/google",
                    "{\"credential\":\"" + keys.token(GoogleTestKeys.claims("sub-1", "carolina@gmail.com", clock.instant())) + "\"}");
            assertThat(r.status()).isEqualTo(200);
        } finally {
            keys.onFetch(() -> {});
        }
        assertThat(inTransaction.get()).as("a key fetch happened").isNotNull();
        assertThat(inTransaction.get()).as("the key fetch ran inside a transaction").isFalse();
    }

    @Test
    void aFailingEmailSenderStaysAServerError() {
        emails.onSend(s -> { throw new IllegalStateException("provider down"); });
        var r = clients.newBrowser().post("/auth/email/start", "{\"email\":\"ana@correo.co\"}");
        assertThat(r.status()).isEqualTo(500);
        assertThat(r.str("/error/code")).isEqualTo("server_error");
    }
}
