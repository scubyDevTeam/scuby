package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PublishBodies;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every request string with a database length CHECK is measured in code points, like Postgres length(): an emoji is
 * one character there but two UTF-16 units in Java. A value the bean check accepted and the CHECK refused was a 500
 * (and a log line); one the bean check refused and the CHECK accepts was a needless 422.
 */
@IntegrationTest
class CodePointLengthTest {

    static final String PHONE = "+573007152284";
    static final String EMOJI = "😀";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired MutableClock clock;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        cases.luna(accounts.person("carolina@correo.co"));
    }

    private ApiResponse sighting(String note, String clientId) {
        String body = """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":%s,"contact_phone":null,"client_id":%s}"""
                .formatted(clock.instant(), note == null ? "null" : "\"" + note + "\"", clientId == null ? "null" : "\"" + clientId + "\"");
        return api.post("/cases/{code}/sightings", body, "7K3PQ");
    }

    @Test
    void aClientIdUnderEightCharactersIsValidationFailedEvenWhenItHasEightUtf16Units() {
        ApiResponse r = sighting(null, EMOJI.repeat(4));        // 4 characters, 8 UTF-16 units
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("client_id")).isTrue();
    }

    @Test
    void aClientIdIsAcceptedFromEightToSixtyFourCharacters() {
        assertThat(sighting(null, EMOJI.repeat(8)).status()).isEqualTo(201);
        assertThat(sighting(null, EMOJI.repeat(64)).status()).isEqualTo(201);
    }

    @Test
    void aClientIdOverSixtyFourCharactersIsValidationFailedNotAServerError() {
        ApiResponse r = sighting(null, EMOJI.repeat(65));
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("client_id")).isTrue();
    }

    @Test
    void aNoteIsMeasuredInCharactersToo() {
        assertThat(sighting(EMOJI.repeat(500), null).status()).isEqualTo(201);      // 1 000 UTF-16 units, 500 characters
        ApiResponse r = sighting(EMOJI.repeat(501), null);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("note")).isTrue();
    }

    private ApiResponse publish(String name, String marks, String chip) {
        accounts.signIn(api, "ana.gomez@correo.co");
        String body = PublishBodies.kira(PHONE, null)
                .replace("\"name\":\"Kira\"", "\"name\":\"" + name + "\"")
                .replace("\"marks\":null", "\"marks\":" + (marks == null ? "null" : "\"" + marks + "\""))
                .replace("\"chip_number\":null", "\"chip_number\":" + (chip == null ? "null" : "\"" + chip + "\""));
        return api.post("/lost-cases", body);
    }

    @Test
    void petTextFieldsAreMeasuredInCharacters() {
        // within the limits in characters, over them in UTF-16 units: all three pass the bean check and the CHECK
        assertThat(publish(EMOJI.repeat(60), EMOJI.repeat(500), EMOJI.repeat(40)).status()).isEqualTo(200);
    }

    @Test
    void petTextOverTheLimitInCharactersIsValidationFailed() {
        ApiResponse r = publish(EMOJI.repeat(61), EMOJI.repeat(501), EMOJI.repeat(41));
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("pet.name")).isTrue();
        assertThat(r.json().at("/error/fields").has("pet.marks")).isTrue();
        assertThat(r.json().at("/error/fields").has("pet.chip_number")).isTrue();
    }
}
