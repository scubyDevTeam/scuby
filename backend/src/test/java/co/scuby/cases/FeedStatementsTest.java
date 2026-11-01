package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Measured SQL per GET /feed (session-cache miss; the flag snapshot is left out, as in StatementCeilings) and the leak check. */
@IntegrationTest
class FeedStatementsTest {

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
    }

    private ApiResponse cold(ApiClient client, String path, Object... vars) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return client.get(path, vars);
    }

    @Test
    void nationalFeedIsOneQueryPlusTheSessionLookup() {
        assertThat(cold(clients.newBrowser(), "/feed").statements()).hasSize(1);
        assertThat(cold(owner, "/feed").statements()).hasSize(2);
    }

    @Test
    void localFeedWithAHitIsOneQueryAndAMissAddsTheNationalFallback() {
        assertThat(cold(clients.newBrowser(), "/feed?lat={lat}&lng={lng}", 6.2442, -75.5812).statements()).hasSize(1);
        assertThat(cold(owner, "/feed?lat={lat}&lng={lng}", 4.711, -74.0721).statements()).hasSize(3);
    }

    @Test
    void theOwnerGetsExactlyThePublicItemAndNoOwnerOnlyField() {
        ApiResponse pub = cold(clients.newBrowser(), "/feed");
        ApiResponse own = cold(owner, "/feed");
        // The one owner-only field is possible_find (decision #76): false for the publisher here, null for the public.
        var ownItems = (tools.jackson.databind.node.ArrayNode) own.json().get("items");
        var pubItems = (tools.jackson.databind.node.ArrayNode) pub.json().get("items");
        assertThat(ownItems).hasSameSizeAs(pubItems);
        for (int i = 0; i < ownItems.size(); i++) {
            assertThat(ownItems.get(i).get("possible_find").isBoolean()).isTrue();
            assertThat(ownItems.get(i).get("possible_find").asBoolean()).as("no claims in this fixture").isFalse();
            assertThat(pubItems.get(i).get("possible_find").isNull()).isTrue();
            var o = ((tools.jackson.databind.node.ObjectNode) ownItems.get(i).deepCopy());
            var p = ((tools.jackson.databind.node.ObjectNode) pubItems.get(i).deepCopy());
            o.remove("possible_find");
            p.remove("possible_find");
            assertThat(o).isEqualTo(p);
        }
        String body = own.json().toString();
        assertThat(body).doesNotContain("radius").doesNotContain("contact").doesNotContain("phone")
                .doesNotContain("email").doesNotContain("whatsapp");
    }
}
