package co.scuby.cases;

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
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A case shows at most its 200 most recent sightings (docs/product/04 · display rules), to the owner and to the public,
 * oldest first as before. The feed's count stays the true number of visible sightings.
 */
@IntegrationTest
class SightingsCapTest {

    static final int CAP = 200;
    static final Instant BASE = MutableClock.START.minusSeconds(10 * 86_400);

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient owner;

    @BeforeEach
    void setUp() {
        testDb.reset();
        owner = clients.newBrowser();
        UUID carolina = accounts.signIn(owner, "carolina@correo.co");
        cases.luna(carolina);
    }

    /** n visible sightings, one a minute apart from BASE (the i-th is seen at BASE + i minutes). */
    private void seedVisible(int n) {
        for (int i = 0; i < n; i++) {
            Instant seen = BASE.plusSeconds(60L * i);
            cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, seen, seen, null, "5".repeat(64), null, "visible");
        }
    }

    private static List<Instant> seenAt(ApiResponse r) {
        List<Instant> out = new ArrayList<>();
        for (JsonNode s : r.json().get("sightings")) out.add(Instant.parse(s.get("seen_at").asString()));
        return out;
    }

    @Test
    void thePublicGetsTheTwoHundredMostRecentOldestFirst() {
        seedVisible(CAP + 50);
        List<Instant> seen = seenAt(clients.newBrowser().get("/cases/{code}", "7K3PQ"));
        assertThat(seen).hasSize(CAP).isSorted();
        assertThat(seen.getFirst()).isEqualTo(BASE.plusSeconds(60L * 50));
        assertThat(seen.getLast()).isEqualTo(BASE.plusSeconds(60L * (CAP + 49)));
    }

    @Test
    void theOwnerGetsTheSameCapIncludingHiddenPinsInsideIt() {
        seedVisible(CAP + 50);
        Instant newest = BASE.plusSeconds(60L * (CAP + 50));
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, newest, newest, null, "6".repeat(64), null, "hidden_by_owner");
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        List<Instant> seen = seenAt(r);
        assertThat(seen).hasSize(CAP).isSorted();
        assertThat(seen.getLast()).isEqualTo(newest);
        assertThat(r.json().at("/sightings/" + (CAP - 1) + "/hidden").asBoolean()).isTrue();
        assertThat(seen.getFirst()).isEqualTo(BASE.plusSeconds(60L * 51));
    }

    @Test
    void hiddenPinsDoNotTakeUpThePublicsTwoHundred() {
        seedVisible(CAP + 5);
        for (int i = 0; i < 30; i++) {
            Instant newer = BASE.plusSeconds(60L * (CAP + 10 + i));
            cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, newer, newer, null, "6".repeat(64), null, "hidden_by_owner");
        }
        List<Instant> seen = seenAt(clients.newBrowser().get("/cases/{code}", "7K3PQ"));
        assertThat(seen).hasSize(CAP);
        assertThat(seen.getLast()).isEqualTo(BASE.plusSeconds(60L * (CAP + 4)));
    }

    @Test
    void aCaseWithFewerThanTheCapShowsAllOfThem() {
        seedVisible(3);
        assertThat(seenAt(clients.newBrowser().get("/cases/{code}", "7K3PQ"))).hasSize(3);
    }

    @Test
    void theFeedStillCountsEverySighting() {
        seedVisible(CAP + 50);
        ApiResponse feed = clients.newBrowser().get("/feed");
        assertThat(feed.json().at("/items/0/sightings_count").asInt()).isEqualTo(CAP + 50);
    }
}
