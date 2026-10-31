package co.scuby.platform.web;

import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A JSON body is bounded before it is bound (application.yml · spring.jackson.factory.constraints.read): an
 * anonymous request must not be able to make the server materialise megabytes. The contract has no 413, so an
 * oversized body is answered {@code validation_failed} (422), never a 500. The limits are far above any real
 * body (a publish is a few KB), so each case below is a body no client sends.
 */
@IntegrationTest
class RequestBodyLimitsTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    private ApiResponse start(String json) {
        return clients.newBrowser().post("/auth/email/start", json);
    }

    private void assertRefused(ApiResponse r) {
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void aNormalBodyStillWorks() {
        assertThat(start("{\"email\":\"ana@correo.co\"}").status()).isEqualTo(204);
    }

    @Test
    void aDocumentOverTheLimitIsRefused() {
        assertRefused(start("{\"email\":\"ana@correo.co\"}" + " ".repeat(70_000)));
    }

    @Test
    void aStringOverTheLimitIsRefused() {
        assertRefused(start("{\"email\":\"ana@correo.co\",\"x\":\"" + "a".repeat(9_000) + "\"}"));
    }

    @Test
    void aMegabyteOfEmailIsRefusedNotBound() {
        assertRefused(start("{\"email\":\"" + "a".repeat(1_000_000) + "\"}"));
    }

    @Test
    void deepNestingIsRefused() {
        assertRefused(start("{\"email\":\"ana@correo.co\",\"x\":" + "[".repeat(100) + "]".repeat(100) + "}"));
    }

    @Test
    void aVeryLongNumberIsRefused() {
        assertRefused(start("{\"email\":\"ana@correo.co\",\"x\":" + "9".repeat(200) + "}"));
    }

    @Test
    void aThousandTinyStringsInAnArrayAreRefusedByTokenCount() {
        assertRefused(start("{\"email\":\"ana@correo.co\",\"x\":[" + "1,".repeat(5_000) + "1]}"));
    }

    @Test
    void aBodyPaddedPastTheLimitOnAnotherEndpointIsRefusedToo() {
        ApiResponse r = clients.newBrowser().post("/auth/google", "{\"credential\":\"" + "a".repeat(70_000) + "\"}");
        assertRefused(r);
    }
}
