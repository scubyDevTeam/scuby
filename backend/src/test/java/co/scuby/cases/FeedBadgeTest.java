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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** possible_find (spec §3, §4.13; decision #76): the publisher's items only; null for everyone else. Leak test of §7.1 for the feed. */
@IntegrationTest
class FeedBadgeTest {

    static final Instant NOW = MutableClock.START;

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient carolinaBrowser;
    ApiClient claimant;
    UUID carolinaId;

    @BeforeEach
    void setUp() {
        carolinaBrowser = clients.newBrowser();
        UUID carolina = carolinaId = accounts.signIn(carolinaBrowser, "carolina@correo.co");
        claimant = clients.newBrowser();
        UUID andres = accounts.signIn(claimant, "andres@correo.co");
        UUID julian = accounts.person("julian@correo.co");
        cases.luna(carolina);                                                                                         // open claim
        cases.lostCase(carolina, "STL22", "Mia", "cat", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(3600));   // stale claim only
        cases.lostCase(carolina, "CNF22", "Max", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));   // confirmed only
        cases.lostCase(julian, "OTH22", "Otro", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(60));      // someone else's
        cases.lostCase(carolina, "RFR22", "Nube", "cat", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(5400));  // a refreshed claim only
        cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofHours(1)), "open");
        cases.claim("STL22", andres, "+573001112233", NOW.minus(Duration.ofDays(8)), "open");
        cases.claim("CNF22", andres, "+573001112233", NOW.minus(Duration.ofDays(1)), "confirmed");
        cases.claim("OTH22", andres, "+573001112233", NOW.minus(Duration.ofHours(1)), "open");
        cases.claim("RFR22", andres, "+573001112233", NOW.minus(Duration.ofDays(9)), NOW.minus(Duration.ofHours(2)), "open");
    }

    private static JsonNode item(ApiResponse feed, String code) {
        for (JsonNode i : feed.json().get("items")) if (i.get("code").asString().equals(code)) return i;
        throw new AssertionError(code + " not in the feed: " + feed.body());
    }

    @Test
    void anonymousStrangerAndClaimantGetNullOnEveryItem() {
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        for (ApiClient viewer : new ApiClient[] {clients.newBrowser(), stranger, claimant}) {
            ApiResponse feed = viewer.get("/feed");
            assertThat(feed.json().get("items")).hasSize(5);
            feed.json().get("items").forEach(i -> assertThat(i.get("possible_find").isNull()).as(i.toString()).isTrue());
        }
    }

    @Test
    void thePublisherSeesTheBadgeOnlyForAnOpenNonStaleClaimAndNullOnOthersItems() {
        ApiResponse feed = carolinaBrowser.get("/feed");
        assertThat(item(feed, "7K3PQ").get("possible_find").asBoolean()).isTrue();
        assertThat(item(feed, "STL22").get("possible_find").asBoolean()).as("stale does not count").isFalse();
        assertThat(item(feed, "CNF22").get("possible_find").asBoolean()).as("answered does not count").isFalse();
        assertThat(item(feed, "STL22").get("possible_find").isNull()).isFalse();
        assertThat(item(feed, "RFR22").get("possible_find").asBoolean()).as("made 9 days ago, repeated 2 h ago: fresh").isTrue();
        assertThat(item(feed, "OTH22").get("possible_find").isNull()).as("someone else's item").isTrue();
    }

    @Test
    void theBadgeDoesNotChangeTheFeedsOrderOrMembership() {
        // A claim never reduces reach (docs/product/04): the same five items in the same order for everyone.
        assertThat(codes(carolinaBrowser.get("/feed"))).hasSize(5).isEqualTo(codes(clients.newBrowser().get("/feed")));
    }

    private static java.util.List<String> codes(ApiResponse feed) {
        java.util.List<String> out = new java.util.ArrayList<>();
        feed.json().get("items").forEach(i -> out.add(i.get("code").asString()));
        return out;
    }

    @Test
    void theStatementCountIsUnchanged() {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        assertThat(carolinaBrowser.get("/feed").statements()).as("national: session, the query").hasSize(2);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        assertThat(carolinaBrowser.get("/feed?lat=6.25&lng=-75.59").statements()).as("local hit").hasSize(2);
    }

    @Test
    void theStaleBoundaryIsInclusiveAtExactlyLastActivePlusSevenDays() {
        cases.lostCase(carolinaId, "EDG22", "Edge", "cat", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(10));
        cases.lostCase(carolinaId, "PST22", "Past", "cat", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(20));
        cases.claim("EDG22", accounts.person("edge@correo.co"), "+573001112233", NOW.minus(Duration.ofDays(7)), "open");                    // + 7 d == now: counts
        cases.claim("PST22", accounts.person("past@correo.co"), "+573001112233", NOW.minus(Duration.ofDays(7)).minusSeconds(1), "open");     // one second past: stale
        ApiResponse feed = carolinaBrowser.get("/feed");
        assertThat(item(feed, "EDG22").get("possible_find").asBoolean()).isTrue();
        assertThat(item(feed, "PST22").get("possible_find").asBoolean()).isFalse();
    }
}
