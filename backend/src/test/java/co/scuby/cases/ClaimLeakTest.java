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

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Leak test (spec §7.1): the claims, their count, reporters' numbers and hidden pins reach the owner only — not an
 * anonymous visitor, not a signed-in stranger, not the claimant. A reporter-deleted pin reaches nobody.
 */
@IntegrationTest
class ClaimLeakTest {

    static final Instant NOW = MutableClock.START;

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient stranger;
    ApiClient claimant;
    ApiClient laura;             // the stale claim's claimant
    UUID deleted;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        UUID carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        claimant = clients.newBrowser();
        UUID andres = accounts.signIn(claimant, "andres@correo.co");
        laura = clients.newBrowser();
        UUID lauraId = accounts.signIn(laura, "laura@correo.co");
        cases.luna(carolina);
        cases.claim("7K3PQ", andres, "+573114440001", NOW.minus(Duration.ofHours(1)), "open");
        cases.claim("7K3PQ", lauraId, "+573114440002", NOW.minus(Duration.ofDays(10)), "open");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(7200), NOW.minusSeconds(7200), null, "3".repeat(64), "+573114440003", "visible");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, "4".repeat(64), "+573114440004", "hidden_by_owner");
        deleted = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), andres, "5".repeat(64), "+573114440005", "deleted_by_reporter");
    }

    private void assertNoPrivateFacts(ApiResponse r, String who) {
        assertThat(r.status()).as(who).isEqualTo(200);
        assertThat(r.str("/viewer")).as(who).isEqualTo("public");
        // The public zone only: the snapped center and the widened radius, never the exact point (decision #69).
        assertThat(r.json().at("/last_seen/radius_m").asDouble()).as(who).isEqualTo(200.0);
        assertThat(r.json().at("/last_seen/center/lng").asDouble()).as(who).isEqualTo(-75.580392);
        assertThat(r.json().get("claims")).as(who).isEmpty();
        assertThat(r.isNull("/open_claim_count")).as(who).isTrue();
        assertThat(r.json().get("sightings")).as(who).hasSize(1);
        r.json().get("sightings").forEach(s -> {
            assertThat(s.get("contact_phone").isNull()).as(who).isTrue();
            assertThat(s.get("hidden").asBoolean()).as(who).isFalse();
        });
        assertThat(r.body()).as(who).doesNotContain("311444000").doesNotContain(deleted.toString());
    }

    @Test
    void nobodyButTheOwnerSeesClaimsCountsNumbersOrHiddenPins() {
        assertNoPrivateFacts(clients.newBrowser().get("/cases/{code}", "7K3PQ"), "anonymous");
        assertNoPrivateFacts(stranger.get("/cases/{code}", "7K3PQ"), "signed-in stranger");
        assertNoPrivateFacts(claimant.get("/cases/{code}", "7K3PQ"), "the claimant");
    }

    @Test
    void theOwnerSeesTheClaimsNewestFirstTheCountTheNumbersAndTheHiddenPinButNotTheDeletedOne() {
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        assertThat(r.json().get("claims")).hasSize(2);
        assertThat(r.str("/claims/0/phone")).isEqualTo("+573114440001");
        assertThat(r.str("/claims/0/status")).isEqualTo("open");
        assertThat(r.str("/claims/1/status")).isEqualTo("stale");
        assertThat(r.json().get("open_claim_count").asInt()).as("the stale claim does not count").isEqualTo(1);
        assertThat(r.json().get("sightings")).hasSize(2);
        assertThat(r.body()).contains("+573114440003").contains("+573114440004").doesNotContain("+573114440005").doesNotContain(deleted.toString());
    }

    @Test
    void theOwnerOfAClosedCaseSeesTheClaimsAndZero() {
        cases.close("7K3PQ", "reunited", NOW.minusSeconds(60));
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        assertThat(r.json().get("claims")).hasSize(2);
        assertThat(r.json().get("open_claim_count").asInt()).isZero();
    }

    /**
     * Laura's claim went stale (10 days without an answer); she still has the dog and taps «Lo tengo» again with a new
     * number: the same claim becomes fresh, the owner sees it as open with the new number, and the badge counts it again.
     */
    @Test
    void aRepeatClaimMakesAStaleClaimFreshAndTheOwnersCountIncludesItAgain() {
        ApiResponse before = owner.get("/cases/{code}", "7K3PQ");
        assertThat(before.str("/claims/1/status")).isEqualTo("stale");
        assertThat(before.json().get("open_claim_count").asInt()).isEqualTo(1);
        ApiResponse again = laura.post("/cases/{code}/recovery-claims", "{\"phone\":\"+573114440009\"}", "7K3PQ");
        assertThat(again.status()).isEqualTo(201);
        ApiResponse after = owner.get("/cases/{code}", "7K3PQ");
        assertThat(after.json().get("claims")).hasSize(2);
        assertThat(after.str("/claims/1/id")).isEqualTo(again.str("/id"));
        assertThat(after.str("/claims/1/status")).isEqualTo("open");
        assertThat(after.str("/claims/1/phone")).isEqualTo("+573114440009");
        assertThat(after.json().get("open_claim_count").asInt()).as("Andrés's and Laura's again").isEqualTo(2);
    }

    @Test
    void theOwnerGetsTheNewest50AndTheCountOverAllOfThemWithinTheSameFourStatements() {
        for (int i = 0; i < 55; i++) {
            cases.claim("7K3PQ", accounts.person("claimant" + i + "@correo.co"), "+57311555%04d".formatted(i), NOW.minus(Duration.ofMinutes(i + 1)), "open");
        }
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        assertThat(r.json().get("claims")).hasSize(50);
        assertThat(r.str("/claims/0/phone")).isEqualTo("+573115550000");
        assertThat(r.json().get("open_claim_count").asInt()).isEqualTo(56);   // 55 new + andres's, all within 7 days
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }

    /** Pins the SQL operator: last_active_at = now - 7 d is not stale (>=), one second older is (and the badge drops it). */
    @Test
    void aClaimIsStaleOnlyPastExactlySevenDaysSinceItsLastActivity() {
        UUID edge = cases.claim("7K3PQ", accounts.person("edge@correo.co"), "+573114440011", NOW.minus(Duration.ofDays(8)), NOW.minus(Duration.ofDays(7)), "open");
        UUID over = cases.claim("7K3PQ", accounts.person("over@correo.co"), "+573114440012", NOW.minus(Duration.ofDays(9)),
                NOW.minus(Duration.ofDays(7)).minusSeconds(1), "open");
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        java.util.Map<String, String> byId = new java.util.HashMap<>();
        r.json().get("claims").forEach(c -> byId.put(c.get("id").asText(), c.get("status").asText()));
        assertThat(byId.get(edge.toString())).isEqualTo("open");
        assertThat(byId.get(over.toString())).isEqualTo("stale");
        assertThat(r.json().get("open_claim_count").asInt()).as("andres + the edge claim; laura and the older one are stale").isEqualTo(2);
    }
}
