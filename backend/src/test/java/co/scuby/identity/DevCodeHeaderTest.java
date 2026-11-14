package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.IntegrationTest;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** auth.md · Codes in development: the code comes back as X-Dev-Code when the local switch is on. */
@IntegrationTest
@TestPropertySource(properties = "scuby.auth.dev-code-header=true")
class DevCodeHeaderTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingEmailSender emails;
    @Autowired RecordingSmsSender sms;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    @Test
    void theEmailCodeComesBackAsAHeader() {
        ApiClient api = clients.newBrowser();
        var r = api.post("/auth/email/start", "{\"email\":\"ana@correo.co\"}");
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.raw().getHeader(DevCodeHeader.NAME)).isEqualTo(emails.lastCodeFor("ana@correo.co"));
    }

    @Test
    void theSmsCodeComesBackAsAHeader() {
        ApiClient api = clients.newBrowser();
        accounts.signIn(api, "ana@correo.co");
        var r = api.post("/me/phone", "{\"phone\":\"+573009998877\"}");
        assertThat(r.raw().getHeader(DevCodeHeader.NAME)).isEqualTo(sms.lastCodeFor("+573009998877"));
    }

    @Test
    void aSendThatDoesNotGoOutSetsNoHeader() {
        ApiClient api = clients.newBrowser();
        api.post("/auth/email/start", "{\"email\":\"ana@correo.co\"}");
        // Inside the 60 s cooldown: answered as sent, nothing sent, so no code to show.
        var again = api.post("/auth/email/start", "{\"email\":\"ana@correo.co\"}");
        assertThat(again.raw().getHeader(DevCodeHeader.NAME)).isNull();
    }

    @Test
    void aDeployedProfileRefusesIt() {
        for (String profile : new String[] {"staging", "prod"}) {
            MockEnvironment env = new MockEnvironment();
            env.setActiveProfiles(profile);
            assertThatThrownBy(() -> new DevCodeHeader(true, env))
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("scuby.auth.dev-code-header");
        }
    }
}
