package co.scuby.cases;

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

import static org.assertj.core.api.Assertions.assertThat;

/** session → not_found → forbidden → body (fields, then photos) → status (spec §3, §4.1). */
@IntegrationTest
class EditLostPrecedenceTest {

    static final String BAD = "{\"last_seen_radius_m\":0}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient owner;
    ApiClient stranger;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        cases.luna(accounts.signIn(owner, "carolina@correo.co"));
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
    }

    @Test
    void anUnreadableBodyIsAnsweredBeforeAnyLookup() {
        assertThat(stranger.patch("/lost-cases/{code}", "{\"marks\":{\"a\":1}}", "ZZZZZ").errorCode()).isEqualTo("validation_failed");
        assertThat(stranger.patch("/lost-cases/{code}", "{\"photo_urls\":\"x\"}", "ZZZZZ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void notFoundBeatsForbiddenAndABadBody() {
        assertThat(stranger.patch("/lost-cases/{code}", BAD, "ZZZZZ").errorCode()).isEqualTo("not_found");
    }

    @Test
    void forbiddenBeatsABadBody() {
        assertThat(stranger.patch("/lost-cases/{code}", BAD, "7K3PQ").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void aBadFieldBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        assertThat(owner.patch("/lost-cases/{code}", BAD, "7K3PQ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void aPhotoNotUploadedBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        var r = owner.patch("/lost-cases/{code}", "{\"photo_urls\":[\"http://localhost/dev-media/" + "0".repeat(64) + ".jpg\"]}", "7K3PQ");
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("photo_urls")).isTrue();
    }
}
