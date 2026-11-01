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
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class MyCasesEndpointTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient carolinaBrowser;
    UUID carolina;

    @BeforeEach
    void setUp() {
        testDb.reset();
        carolinaBrowser = clients.newBrowser();
        carolina = accounts.signIn(carolinaBrowser, "carolina@correo.co");
    }

    private static List<String> codes(ApiResponse r) {
        List<String> out = new ArrayList<>();
        r.json().forEach(i -> out.add(i.get("code").asString()));
        return out;
    }

    /** A session-cache miss (the process-wide flag snapshot is left out, as in StatementCeilings). */
    private ApiResponse cold(ApiClient client) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return client.get("/me/cases");
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        assertThat(clients.newBrowser().get("/me/cases").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void everyCaseTheCallerPublishedInAnyStatusNewestFirstAndNoOneElses() {
        cases.lostCase(carolina, "OLD22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "reunited", MutableClock.START.minusSeconds(5 * 86_400));
        cases.luna(carolina);                                                    // published 2 days ago
        cases.lostCase(carolina, "NEW22", "Max", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600));
        cases.lostCase(accounts.person("other@correo.co"), "OTH22", "Otro", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START);
        ApiResponse r = carolinaBrowser.get("/me/cases");
        assertThat(r.status()).isEqualTo(200);
        assertThat(codes(r)).containsExactly("NEW22", "7K3PQ", "OLD22");
        assertThat(r.str("/0/vertical")).isEqualTo("lost");
        assertThat(r.str("/0/title")).isEqualTo("Max");
        assertThat(r.str("/0/place_name")).isEqualTo("Zona marcada en el mapa");
        assertThat(r.str("/0/photo_url")).endsWith(".jpg");
        assertThat(r.json().at("/0/open_claim_count").asInt()).isZero();
        assertThat(r.isNull("/0/pending_checkin_at")).isTrue();
        assertThat(r.str("/2/status")).isEqualTo("reunited");
    }

    /** Leak test: each caller sees exactly their own cases, never another account's. */
    @Test
    void eachAccountSeesOnlyItsOwnCases() {
        ApiClient otherBrowser = clients.newBrowser();
        UUID other = accounts.signIn(otherBrowser, "other@correo.co");
        cases.lostCase(carolina, "MINE2", "Mia", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(60));
        cases.lostCase(other, "THEIR", "Theirs", "cat", CaseFixtures.MEDELLIN, 300, "reunited", MutableClock.START.minusSeconds(30));
        assertThat(codes(carolinaBrowser.get("/me/cases"))).containsExactly("MINE2");
        assertThat(codes(otherBrowser.get("/me/cases"))).containsExactly("THEIR");
        ApiResponse mine = carolinaBrowser.get("/me/cases");
        assertThat(mine.body()).doesNotContain("THEIR").doesNotContain("Theirs");
    }

    @Test
    void aDeviceOnlyCallerCannotReadAnyonesCases() {
        cases.lostCase(carolina, "MINE2", "Mia", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START);
        assertThat(clients.newBrowser().get("/me/cases").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void noCasesIsAnEmptyList() {
        assertThat(carolinaBrowser.get("/me/cases").json()).isEmpty();
    }

    @Test
    void theStatementCountIsTwoWhetherTheCallerHasOneCaseOrTwenty() {
        cases.lostCase(carolina, "M0000", "P0", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600));
        ApiResponse one = cold(carolinaBrowser);
        assertThat(one.json()).hasSize(1);
        assertThat(one.statements()).hasSize(2);                                // session lookup + the cases query
        for (int i = 1; i < 20; i++) {
            cases.lostCase(carolina, "M%04d".formatted(i), "P" + i, "dog", CaseFixtures.MEDELLIN, 300,
                    i % 2 == 0 ? "active" : "expired", MutableClock.START.minusSeconds(3600L * (i + 1)));
        }
        ApiResponse twenty = cold(carolinaBrowser);
        assertThat(twenty.json()).hasSize(20);
        assertThat(twenty.statements()).hasSize(2);
    }

    @Test
    void openClaimCountCountsOpenNonStaleClaimsOnActiveCasesOnly() {
        cases.luna(carolina);                                                                   // active
        cases.lostCase(carolina, "EXP22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(86_400 * 5));
        cases.close("EXP22", "expired", MutableClock.START.minusSeconds(86_400));
        UUID a = accounts.person("andres@correo.co");
        UUID b = accounts.person("laura@correo.co");
        cases.claim("7K3PQ", a, "+573001112233", MutableClock.START.minusSeconds(3600), "open");
        cases.claim("7K3PQ", b, "+573001112244", MutableClock.START.minusSeconds(60), "open");
        cases.claim("7K3PQ", accounts.person("pedro@correo.co"), "+573001112255", MutableClock.START.minus(java.time.Duration.ofDays(8)), "open");
        cases.claim("7K3PQ", accounts.person("ana@correo.co"), "+573001112266", MutableClock.START.minusSeconds(60), "dismissed");
        cases.claim("7K3PQ", accounts.person("julian@correo.co"), "+573001112277", MutableClock.START.minus(java.time.Duration.ofDays(9)),
                MutableClock.START.minusSeconds(600), "open");                                 // made 9 days ago, repeated 10 min ago: fresh
        cases.claim("EXP22", a, "+573001112233", MutableClock.START.minusSeconds(3600), "open");
        ApiResponse r = cold(carolinaBrowser);
        assertThat(codes(r)).containsExactly("7K3PQ", "EXP22");
        assertThat(r.json().at("/0/open_claim_count").asInt()).as("two open, one refreshed, one stale, one dismissed").isEqualTo(3);
        assertThat(r.json().at("/1/open_claim_count").asInt()).as("not active").isZero();
        assertThat(r.statements()).hasSize(2);
    }

    @Test
    void theStaleBoundaryIsInclusiveAtExactlyLastActivePlusSevenDays() {
        cases.luna(carolina);
        java.time.Instant edge = MutableClock.START.minus(java.time.Duration.ofDays(7));
        cases.claim("7K3PQ", accounts.person("andres@correo.co"), "+573001112233", edge, "open");                       // last_active_at + 7d == now: not stale
        cases.claim("7K3PQ", accounts.person("laura@correo.co"), "+573001112244", edge.minusSeconds(1), "open");        // one second past: stale
        assertThat(cold(carolinaBrowser).json().at("/0/open_claim_count").asInt()).isEqualTo(1);
    }
}
