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

/** session → not_found / gone → forbidden (the owner) → body (phone, photos; from_sighting_id is never an error) → status (spec §4.9, assumption 3). */
@IntegrationTest
class RecoveryClaimPrecedenceTest {

    static final String PATH = "/cases/{code}/recovery-claims";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient owner;
    ApiClient helper;
    UUID carolina;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        helper = clients.newBrowser();
        accounts.signIn(helper, "andres@correo.co");
        cases.luna(carolina);
        cases.purge("GONE5");
    }

    @Test
    void unauthorizedBeatsAnUnreadableBody() {
        assertThat(clients.newBrowser().post(PATH, "{", "ZZZZZ").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void notFoundAndGoneBeatForbiddenAndABadBody() {
        assertThat(owner.post(PATH, "{\"phone\":null}", "ZZZZZ").errorCode()).isEqualTo("not_found");
        assertThat(helper.post(PATH, "{\"phone\":null}", "GONE5").errorCode()).isEqualTo("gone");
    }

    @Test
    void forbiddenBeatsABadBody() {
        assertThat(owner.post(PATH, "{\"phone\":null}", "7K3PQ").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void aBadBodyBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        assertThat(helper.post(PATH, "{\"phone\":\"+5716012345\"}", "7K3PQ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void aBadPhoneIsTheOnlyFieldNamedAnIneligibleLinkIsNeverAnError() {
        var r = helper.post(PATH, "{\"phone\":\"+5716012345\",\"from_sighting_id\":\"x\"}", "7K3PQ");
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
        assertThat(r.json().at("/error/fields").has("from_sighting_id")).isFalse();
    }

    @Test
    void invalidTransitionBeatsActiveCaseExists() {
        cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(31)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", MutableClock.START);
        assertThat(helper.post(PATH, "{\"phone\":\"+573001112233\"}", "7K3PQ").errorCode()).isEqualTo("invalid_transition");
    }
}
