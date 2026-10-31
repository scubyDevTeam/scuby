package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import static co.scuby.db.generated.Tables.EMAIL_CODE;
import static org.assertj.core.api.Assertions.assertThat;

/** The error cases the contract lists for identity's endpoints that no other test reaches. */
@IntegrationTest
class ContractErrorCasesTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired DSLContext db;
    @Autowired RecordingEmailSender emails;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    @Test
    void phoneVerifyWithoutASessionIs401() {
        ApiResponse r = api.post("/me/phone/verify", "{\"phone\":\"+573009998877\",\"code\":\"123456\"}");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void phoneVerifyWithAMalformedBodyIs422NamingTheFields() {
        accounts.signIn(api, "ana@correo.co");
        ApiResponse r = api.post("/me/phone/verify", "{\"phone\":\"3009998877\",\"code\":\"12\"}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
        assertThat(r.json().at("/error/fields").has("code")).isTrue();
    }

    @Test
    void googleWithoutACredentialIs422() {
        for (String body : new String[] {"{}", "{\"credential\":\"\"}", "{\"credential\":\"  \"}"}) {
            ApiResponse r = api.post("/auth/google", body);
            assertThat(r.status()).as(body).isEqualTo(422);
            assertThat(r.json().at("/error/fields").has("credential")).as(body).isTrue();
        }
    }

    @Test
    void googleWithAnOversizedCredentialIs422BeforeAnyParsing() {
        ApiResponse r = api.post("/auth/google", "{\"credential\":\"" + "a".repeat(4097) + "\"}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("credential")).isTrue();
    }

    @Test
    void emailVerifyWithAMissingFieldOrANonSixDigitCodeIs422() {
        ApiResponse noCode = api.post("/auth/email/verify", "{\"email\":\"ana@correo.co\"}");
        assertThat(noCode.status()).isEqualTo(422);
        assertThat(noCode.json().at("/error/fields").has("code")).isTrue();
        ApiResponse letters = api.post("/auth/email/verify", "{\"email\":\"ana@correo.co\",\"code\":\"abcdef\"}");
        assertThat(letters.status()).isEqualTo(422);
    }

    /** The 403 is not documented on this endpoint (the contract cannot be changed here), hence unchecked(). */
    @Test
    void aCrossOriginStateChangingCallIsRefusedBeforeItDoesAnything() {
        ApiResponse r = api.header("Origin", "https://evil.example").unchecked(HttpMethod.POST, "/auth/email/start",
                "{\"email\":\"ana@correo.co\"}", "Origin-check 403 is not listed on this endpoint in openapi.json");
        assertThat(r.status()).isEqualTo(403);
        assertThat(r.errorCode()).isEqualTo("forbidden");
        assertThat(emails.sent()).isEmpty();
        assertThat(db.fetchCount(EMAIL_CODE)).isZero();
    }

    @Test
    void aCrossSiteFetchMetadataCallIsRefusedToo() {
        ApiResponse r = api.header("Sec-Fetch-Site", "cross-site").unchecked(HttpMethod.POST, "/auth/google",
                "{\"credential\":\"x\"}", "Origin-check 403 is not listed on this endpoint in openapi.json");
        assertThat(r.status()).isEqualTo(403);
    }
}
