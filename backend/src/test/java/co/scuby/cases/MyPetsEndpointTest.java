package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** GET /me/pets (spec §4.11): the caller's active owner links, their active and reopenable codes, by case activity. */
@IntegrationTest
class MyPetsEndpointTest {

    static final Instant NOW = MutableClock.START;

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient carolinaBrowser;
    UUID carolina;

    @BeforeEach
    void setUp() {
        carolinaBrowser = clients.newBrowser();
        carolina = accounts.signIn(carolinaBrowser, "carolina@correo.co");
    }

    private static Instant daysAgo(long d) {
        return NOW.minus(Duration.ofDays(d));
    }

    private static List<String> names(ApiResponse r) {
        List<String> out = new ArrayList<>();
        r.json().forEach(p -> out.add(p.get("name").asString()));
        return out;
    }

    private static JsonNode pet(ApiResponse r, String name) {
        for (JsonNode p : r.json()) if (p.get("name").asString().equals(name)) return p;
        throw new AssertionError(name + " not listed: " + r.body());
    }

    private ApiResponse cold() {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return carolinaBrowser.get("/me/pets");
    }

    @Test
    void eachPetWithItsActiveOrReopenableCaseOrderedByCaseActivity() {
        cases.luna(carolina);                                                                             // active 7K3PQ, published 2 days ago
        UUID luna = cases.petOf("7K3PQ");
        cases.lostCaseForPet(carolina, luna, "LUN22", "expired", daysAgo(10));                            // expired 9 days ago: hidden by the active one
        cases.lostCase(carolina, "TOB22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(10));
        cases.close("TOB22", "expired", daysAgo(3));
        cases.lostCaseForPet(carolina, cases.petOf("TOB22"), "TOB11", "expired", daysAgo(20));            // older expiry: not the latest
        cases.lostCase(carolina, "MIA22", "Mia", "cat", CaseFixtures.MEDELLIN, 300, "active", daysAgo(20));
        cases.close("MIA22", "reunited", daysAgo(19));
        cases.lostCase(carolina, "MAX22", "Max", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(50));
        cases.close("MAX22", "expired", daysAgo(40));                                                    // outside the window
        cases.ownedPet(carolina, null, daysAgo(100));                                                     // no case, no name
        cases.ownedPet(carolina, "Nube", daysAgo(50));                                                    // no case, newer pet: before the nameless one

        ApiResponse r = carolinaBrowser.get("/me/pets");
        assertThat(r.status()).isEqualTo(200);
        assertThat(names(r)).as("case activity desc, nulls last, then pet.created_at desc").containsExactly("Luna", "Toby", "Mia", "Max", "Nube", "");
        assertThat(pet(r, "Luna").get("active_case_code").asString()).isEqualTo("7K3PQ");
        assertThat(pet(r, "Luna").get("reopenable_case_code").isNull()).isTrue();
        assertThat(pet(r, "Toby").get("active_case_code").isNull()).isTrue();
        assertThat(pet(r, "Toby").get("reopenable_case_code").asString()).isEqualTo("TOB22");
        assertThat(pet(r, "Mia").get("reopenable_case_code").isNull()).as("reunited is not reopenable").isTrue();
        assertThat(pet(r, "Max").get("reopenable_case_code").isNull()).as("40 days").isTrue();
        assertThat(pet(r, "").get("active_case_code").isNull()).isTrue();
        assertThat(pet(r, "Luna").get("species").asString()).isEqualTo("dog");
        assertThat(pet(r, "Luna").get("size").asString()).isEqualTo("small");
        assertThat(pet(r, "Luna").get("colors").toString()).isEqualTo("[\"black\",\"tan\"]");
        assertThat(pet(r, "Luna").get("photo_urls")).hasSize(1);
        assertThat(pet(r, "Luna").get("id").asString()).isEqualTo(luna.toString());
    }

    @Test
    void theWindowIsThirtyDaysInclusive() {
        cases.lostCase(carolina, "EDG30", "Edge", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(40));
        cases.close("EDG30", "expired", daysAgo(30));
        cases.lostCase(carolina, "EDG31", "Past", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(40));
        cases.close("EDG31", "expired", daysAgo(30).minusMillis(1));
        ApiResponse r = carolinaBrowser.get("/me/pets");
        assertThat(pet(r, "Edge").get("reopenable_case_code").asString()).isEqualTo("EDG30");
        assertThat(pet(r, "Past").get("reopenable_case_code").isNull()).isTrue();
    }

    @Test
    void onlyTheCallersOwnCasesCount() {
        UUID julian = accounts.person("julian@correo.co");
        cases.lostCase(carolina, "TOB22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(10));
        cases.close("TOB22", "expired", daysAgo(3));
        cases.lostCaseForPet(julian, cases.petOf("TOB22"), "JUL22", "active", daysAgo(1));   // someone else's active case of the same pet
        ApiResponse r = carolinaBrowser.get("/me/pets");
        assertThat(pet(r, "Toby").get("active_case_code").isNull()).isTrue();
        assertThat(pet(r, "Toby").get("reopenable_case_code").asString()).isEqualTo("TOB22");
    }

    @Test
    void endedLinksAndOtherPeoplesPetsAreNotListed() {
        UUID given = cases.ownedPet(carolina, "Regalado", daysAgo(5));
        cases.unlink(given, daysAgo(1));
        cases.lostCase(accounts.person("julian@correo.co"), "JUL22", "DeJulian", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(1));
        cases.ownedPet(carolina, "Mía", daysAgo(2));
        assertThat(names(carolinaBrowser.get("/me/pets"))).containsExactly("Mía");
    }

    @Test
    void anEditOfACaseShowsOnThePet() {
        cases.luna(carolina);
        assertThat(carolinaBrowser.patch("/lost-cases/{code}", "{\"marks\":\"Collar azul\"}", "7K3PQ").status()).isEqualTo(204);
        assertThat(pet(carolinaBrowser.get("/me/pets"), "Luna").get("marks").asString()).isEqualTo("Collar azul");
    }

    @Test
    void noPetsIsAnEmptyListAndNobodySignedInIsUnauthorized() {
        assertThat(carolinaBrowser.get("/me/pets").json()).isEmpty();
        ApiResponse anon = clients.newBrowser().get("/me/pets");
        assertThat(anon.status()).isEqualTo(401);
        assertThat(anon.errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void theStatementCountIsTwoWithOnePetOrTwenty() {
        cases.lostCase(carolina, "P0000", "P0", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(1));
        ApiResponse one = cold();
        assertThat(one.json()).hasSize(1);
        assertThat(one.statements()).as("%s", one.statements()).hasSize(2);   // session lookup, the pets query
        for (int i = 1; i < 20; i++) {
            cases.lostCase(carolina, "P%04d".formatted(i), "P" + i, "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(i + 1));
            if (i % 2 == 0) cases.close("P%04d".formatted(i), "expired", daysAgo(i));
        }
        ApiResponse twenty = cold();
        assertThat(twenty.json()).hasSize(20);
        assertThat(twenty.statements()).hasSize(2);
    }
}
