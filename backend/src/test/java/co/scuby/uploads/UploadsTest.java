package co.scuby.uploads;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class UploadsTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired MutableClock clock;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    static byte[] photo() {
        return ("jpeg-bytes-" + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8);
    }

    static String slotBody(String purpose, String sha256, int bytes) {
        return """
                {"purpose":"%s","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(purpose, sha256, bytes);
    }

    // Port of backend.test.ts «answers a slot to send the bytes to, and the URL the photo will have».
    @Test
    void aSlotNamesTheUrlFromTheHashAndWhereToPut() {
        byte[] bytes = photo();
        String sha = Hashing.sha256Hex(bytes);
        ApiResponse r = api.post("/uploads", slotBody("sighting", sha, bytes.length));
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/url")).contains(sha).endsWith(".jpg");
        assertThat(r.str("/upload/method")).isEqualTo("PUT");
        assertThat(r.str("/upload/url")).isEqualTo(r.str("/url"));
        assertThat(r.str("/upload/headers/content-type")).isEqualTo("image/jpeg");
        assertThat(r.str("/upload/expires_at")).isEqualTo("2026-10-14T17:05:00Z");
    }

    // Port of backend.test.ts «serves the photo once the bytes are sent, and answers no slot for a photo it has».
    @Test
    void bytesPutToTheSlotAreServedAndTheNextSlotIsEmpty() {
        byte[] bytes = photo();
        String sha = Hashing.sha256Hex(bytes);
        ApiResponse slot = api.post("/uploads", slotBody("sighting", sha, bytes.length));
        String path = slot.str("/url").substring(slot.str("/url").indexOf("/dev-media/"));
        assertThat(api.raw(HttpMethod.GET, path, null).status()).isEqualTo(404);
        assertThat(api.rawBytes(HttpMethod.PUT, path, bytes, "image/jpeg").status()).isEqualTo(200);
        ApiResponse served = api.raw(HttpMethod.GET, path, null);
        assertThat(served.status()).isEqualTo(200);
        assertThat(served.raw().getContentAsByteArray()).isEqualTo(bytes);
        assertThat(api.post("/uploads", slotBody("sighting", sha, bytes.length)).isNull("/upload")).isTrue();
    }

    @Test
    void theDevBucketRefusesBytesThatDoNotMatchTheHash() {
        byte[] bytes = photo();
        String sha = Hashing.sha256Hex(bytes);
        api.post("/uploads", slotBody("sighting", sha, bytes.length));
        ApiResponse r = api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", photo(), "image/jpeg", sha);
        assertThat(r.status()).isEqualTo(422);
    }

    @Test
    void theDevBucketRefusesABodyOverTheContractMaximumAndStoresNothing() {
        byte[] huge = new byte[10_000_001];
        String sha = Hashing.sha256Hex(huge);
        ApiResponse r = api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", huge, "image/jpeg", sha);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").toString()).contains("too large");
        assertThat(api.raw(HttpMethod.GET, "/dev-media/" + sha + ".jpg", null).status()).isEqualTo(404);
    }

    @Test
    void aMismatchedBodyIsNotStoredEither() {
        byte[] bytes = photo();
        String sha = Hashing.sha256Hex(bytes);
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", photo(), "image/jpeg", sha);
        assertThat(api.raw(HttpMethod.GET, "/dev-media/" + sha + ".jpg", null).status()).isEqualTo(404);
    }

    // Port of backend.test.ts «refuses a hash that is not a SHA-256».
    @Test
    void aHashThatIsNotASha256IsValidationFailed() {
        ApiResponse r = api.post("/uploads", slotBody("pet", "nope", 3));
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("sha256")).isTrue();
    }

    @Test
    void petAndProfileSlotsNeedASession() {
        String sha = Hashing.sha256Hex(photo());
        ApiResponse anonymous = api.post("/uploads", slotBody("pet", sha, 3));
        assertThat(anonymous.errorCode()).isEqualTo("validation_failed");
        assertThat(anonymous.json().at("/error/fields").has("purpose")).isTrue();
        accounts.signIn(api, "ana@correo.co");
        assertThat(api.post("/uploads", slotBody("pet", sha, 3)).status()).isEqualTo(201);
    }

    @Test
    void twentySlotsPerCallerPerTenMinutes() {
        for (int i = 0; i < 20; i++) {
            assertThat(api.post("/uploads", slotBody("sighting", Hashing.sha256Hex(photo()), 3)).status()).isEqualTo(201);
        }
        assertThat(api.post("/uploads", slotBody("sighting", Hashing.sha256Hex(photo()), 3)).errorCode()).isEqualTo("rate_limited");
        clock.advance(Duration.ofMinutes(10).plusSeconds(1));
        assertThat(api.post("/uploads", slotBody("sighting", Hashing.sha256Hex(photo()), 3)).status()).isEqualTo(201);
    }

    @Test
    void tooBigOrNotJpegIsValidationFailed() {
        String sha = Hashing.sha256Hex(photo());
        assertThat(api.post("/uploads", slotBody("sighting", sha, 10_000_001)).errorCode()).isEqualTo("validation_failed");
        assertThat(api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/png","bytes":3}""".formatted(sha)).errorCode())
                .isEqualTo("validation_failed");
    }
}
