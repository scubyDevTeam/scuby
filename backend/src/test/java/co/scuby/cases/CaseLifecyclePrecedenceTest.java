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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** When two rules fail at once, the first of session → not_found → forbidden → body → status wins (spec §3). */
@IntegrationTest
class CaseLifecyclePrecedenceTest {

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient owner;
    ApiClient stranger;
    UUID carolina;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        cases.luna(carolina);
    }

    @Test
    void unauthorizedBeatsEverything() {
        assertThat(clients.newBrowser().post("/cases/{code}/reunite", "{", "ZZZZZ").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anUnreadableBodyBeatsTheLookups() {
        assertThat(stranger.post("/cases/{code}/reunite", "{\"resolution_attribution\":{\"x\":1}}", "ZZZZZ").errorCode())
                .isEqualTo("validation_failed");
        assertThat(stranger.post("/cases/{code}/cancel", "{", "ZZZZZ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void notFoundBeatsABadBody() {
        assertThat(stranger.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"luck\"}", "ZZZZZ").errorCode()).isEqualTo("not_found");
    }

    @Test
    void forbiddenBeatsABadBody() {
        assertThat(stranger.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"luck\"}", "7K3PQ").errorCode()).isEqualTo("forbidden");
        assertThat(stranger.post("/cases/{code}/cancel", "{\"resolution\":null}", "7K3PQ").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void forbiddenBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        assertThat(stranger.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"offline\"}", "7K3PQ").errorCode()).isEqualTo("forbidden");
        assertThat(stranger.post("/cases/{code}/reopen", null, "7K3PQ").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void aBadBodyBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        assertThat(owner.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"luck\"}", "7K3PQ").errorCode()).isEqualTo("validation_failed");
        assertThat(owner.post("/cases/{code}/cancel", "{\"resolution\":\"no_response\"}", "7K3PQ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void invalidTransitionBeatsActiveCaseExistsOnReopen() {
        cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(31)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", MutableClock.START);
        assertThat(owner.post("/cases/{code}/reopen", null, "7K3PQ").errorCode()).isEqualTo("invalid_transition");
    }
}
