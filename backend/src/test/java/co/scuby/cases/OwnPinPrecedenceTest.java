package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Correction: not_found → forbidden → invalid_transition → fields → seen_at_in_future → seen_at_before_case → too far (spec §4.7). */
@IntegrationTest
class OwnPinPrecedenceTest {

    static final Instant CREATED = MutableClock.START.minus(Duration.ofMinutes(5));
    static final String PATH = "/cases/{code}/sightings/{sightingId}/correction";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient reporter;
    UUID mine;
    UUID someoneElses;

    @BeforeEach
    void setUp() {
        UUID carolina = accounts.person("carolina@correo.co");
        cases.luna(carolina);
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(7200));
        reporter = clients.newBrowser();
        reporter.get("/config");
        String device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        mine = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, null, device, null, "visible");
        someoneElses = cases.sighting("OTH22", CaseFixtures.MEDELLIN, CREATED, CREATED, null, "7".repeat(64), null, "visible");
    }

    private String body(String point, String seenAt, String note) {
        return "{\"point\":" + point + ",\"seen_at\":\"" + seenAt + "\",\"note\":" + note + "}";
    }

    @Test
    void notFoundBeatsForbidden() {
        assertThat(reporter.post(PATH, body("{\"lat\":6.25,\"lng\":-75.59}", "2026-10-14T16:50:00Z", "null"), "7K3PQ", someoneElses).errorCode())
                .isEqualTo("not_found");
    }

    @Test
    void forbiddenBeatsAClosedCase() {
        cases.close("OTH22", "reunited", MutableClock.START.minusSeconds(60));
        assertThat(reporter.post(PATH, body("{\"lat\":6.25,\"lng\":-75.59}", "2026-10-14T16:50:00Z", "null"), "OTH22", someoneElses).errorCode())
                .isEqualTo("forbidden");
    }

    @Test
    void aClosedCaseBeatsABrokenField() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minusSeconds(60));
        assertThat(reporter.post(PATH, body("null", "2026-10-14T16:50:00Z", "null"), "7K3PQ", mine).errorCode()).isEqualTo("invalid_transition");
    }

    @Test
    void aBrokenFieldBeatsTheSightingRules() {
        var r = reporter.post(PATH, body("{\"lat\":4.711,\"lng\":-74.07}", "2026-10-15T17:00:00Z", "\"" + "a".repeat(501) + "\""), "7K3PQ", mine);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("note")).isTrue();
    }

    @Test
    void futureBeatsBeforeCaseAndBeforeCaseBeatsTooFar() {
        assertThat(reporter.post(PATH, body("{\"lat\":4.711,\"lng\":-74.07}", "2026-10-15T17:00:00Z", "null"), "7K3PQ", mine).errorCode())
                .isEqualTo("seen_at_in_future");
        assertThat(reporter.post(PATH, body("{\"lat\":4.711,\"lng\":-74.07}", "2026-10-01T17:00:00Z", "null"), "7K3PQ", mine).errorCode())
                .isEqualTo("seen_at_before_case");
    }
}
