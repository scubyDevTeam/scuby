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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Measured SQL per GET /cases/{code} (session-cache miss; the process-wide flag snapshot is left out, as in
 * StatementCeilings) and the query spy: what a PUBLIC read does and does not ask the database for.
 */
@IntegrationTest
class CaseStatementsTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;

    @BeforeEach
    void setUp() {
        testDb.reset();
        owner = clients.newBrowser();
        UUID carolina = accounts.signIn(owner, "carolina@correo.co");
        cases.luna(carolina);
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, MutableClock.START.minusSeconds(60), MutableClock.START.minusSeconds(60),
                null, "4".repeat(64), "+573004445566", "hidden_by_owner");
    }

    private ApiResponse cold(ApiClient client) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return client.get("/cases/{code}", "7K3PQ");
    }

    @Test
    void ownerReadIsSessionLookupCaseSightingsAndClaims() {
        assertThat(cold(owner).statements()).hasSize(4);
    }

    @Test
    void aNonOwnerReadNeverQueriesTheClaims() {
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        assertThat(cold(stranger).statements()).noneMatch(s -> s.contains("recovery_claim"));
        assertThat(cold(clients.newBrowser()).statements()).noneMatch(s -> s.contains("recovery_claim"));
        assertThat(cold(owner).statements()).anyMatch(s -> s.contains("\"recovery_claim\""));
    }

    @Test
    void signedInStrangerReadIsTheSameThree() {
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        assertThat(cold(stranger).statements()).hasSize(3);
    }

    @Test
    void anonymousReadIsTwoStatements() {
        assertThat(cold(clients.newBrowser()).statements()).hasSize(2);
    }

    @Test
    void aPublicReadNeverSelectsASightingsContactPhone() {
        ApiResponse pub = cold(clients.newBrowser());
        assertThat(pub.statements()).noneMatch(s -> s.contains("\"sighting\".\"contact_phone\""));
        ApiResponse own = cold(owner);
        assertThat(own.statements()).anyMatch(s -> s.contains("\"sighting\".\"contact_phone\""));
    }

    @Test
    void aPublicReadOfThePublishersNumberGoesThroughTheCaseGuard() {
        // The only statement that names lost_case.contact_phone does so inside the CASE that yields NULL unless public.
        ApiResponse pub = cold(clients.newBrowser());
        assertThat(pub.statements()).filteredOn(s -> s.contains("\"lost_case\".\"contact_phone\""))
                .hasSize(1).allSatisfy(s -> assertThat(s).contains("case when"));
    }

    @Test
    void aPublicReadOnlyQueriesVisibleSightings() {
        ApiResponse pub = cold(clients.newBrowser());
        assertThat(pub.statements()).filteredOn(s -> s.contains("from \"scuby\".\"sighting\"") || s.contains("\"sighting\""))
                .isNotEmpty().allSatisfy(s -> assertThat(s).contains("\"sighting\".\"status\" = ?"));
    }
}
