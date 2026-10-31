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
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** Which error wins when two apply at once (the order in docs/product/04 · Validation), the contact-phone leak, and measured statements. */
@IntegrationTest
class SightingPrecedenceTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient api;
    ApiClient owner;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        owner = clients.newBrowser();
        cases.luna(accounts.signIn(owner, "carolina@correo.co"));
    }

    private String json(double lat, double lng, String seenAt, String phone, String extra) {
        return """
                {"point":{"lat":%s,"lng":%s},"seen_at":"%s","note":null,"contact_phone":%s%s}"""
                .formatted(lat, lng, seenAt, phone == null ? "null" : "\"" + phone + "\"", extra);
    }

    private ApiResponse post(ApiClient as, String code, String body) {
        return as.post("/cases/{code}/sightings", body, code);
    }

    private String ok() { return clock.instant().toString(); }

    @Test
    void theBodyIsCheckedBeforeTheCase() {
        assertThat(post(api, "ZZZZZ", json(6.2455, -75.5905, ok(), "12345", "")).errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void notFoundBeatsReplayAndEverythingElse() {
        assertThat(post(api, "ZZZZZ", json(4.711, -74.07, clock.instant().plus(Duration.ofDays(1)).toString(), null, ",\"client_id\":\"never-seen-1\"")).errorCode())
                .isEqualTo("not_found");
    }

    @Test
    void aReplayBeatsAFutureSeenAtOnAClosedCase() {
        String first = post(api, "7K3PQ", json(6.2455, -75.5905, ok(), null, ",\"client_id\":\"replay-precedence\"")).str("/id");
        db.execute("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        ApiResponse again = post(clients.newBrowser(), "7K3PQ",
                json(4.711, -74.07, clock.instant().plus(Duration.ofDays(1)).toString(), "+5716012345", ",\"client_id\":\"replay-precedence\""));
        assertThat(again.status()).isEqualTo(201);
        assertThat(again.str("/id")).isEqualTo(first);
    }

    @Test
    void aClientIdIsPerCaseAndANullOneIsNeverDeduplicated() {
        assertThat(post(api, "7K3PQ", json(6.2455, -75.5905, ok(), null, "")).status()).isEqualTo(201);
        assertThat(post(api, "7K3PQ", json(6.2455, -75.5905, ok(), null, "")).status()).isEqualTo(201);
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(2);
    }

    @Test
    void closedCaseBeatsFutureSeenAt() {
        db.execute("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        assertThat(post(api, "7K3PQ", json(6.2455, -75.5905, clock.instant().plus(Duration.ofDays(1)).toString(), null, "")).errorCode())
                .isEqualTo("invalid_transition");
    }

    @Test
    void futureBeatsTooFar() {
        assertThat(post(api, "7K3PQ", json(4.711, -74.07, clock.instant().plus(Duration.ofHours(1)).toString(), null, "")).errorCode())
                .isEqualTo("seen_at_in_future");
    }

    @Test
    void tooFarBeatsABadContactPhone() {
        assertThat(post(api, "7K3PQ", json(4.711, -74.07, ok(), "+5716012345", "")).errorCode()).isEqualTo("sighting_too_far");
    }

    @Test
    void aBadContactPhoneBeatsABadPhoto() {
        ApiResponse r = post(api, "7K3PQ", json(6.2455, -75.5905, ok(), "+5716012345", ",\"photo_urls\":[\"http://localhost/dev-media/" + "0".repeat(64) + ".jpg\"]"));
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("contact_phone")).isTrue();
        assertThat(r.json().at("/error/fields").has("photo_urls")).isFalse();
    }

    @Test
    void aBadPhotoBeatsTheRateLimit() {
        for (int i = 0; i < 5; i++) assertThat(post(api, "7K3PQ", json(6.2455, -75.5905, ok(), null, "")).status()).isEqualTo(201);
        ApiResponse r = post(api, "7K3PQ", json(6.2455, -75.5905, ok(), null, ",\"photo_urls\":[\"http://localhost/dev-media/" + "0".repeat(64) + ".jpg\"]"));
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("photo_urls")).isTrue();
    }

    @Test
    void aRefusedSightingStoresNothing() {
        post(api, "7K3PQ", json(4.711, -74.07, ok(), null, ""));
        assertThat(db.fetchCount(SIGHTING)).isZero();
    }

    @Test
    void theContactPhoneReachesTheOwnerAndNeverTheCrowd() {
        assertThat(post(api, "7K3PQ", json(6.2455, -75.5905, ok(), "+573001112233", "")).status()).isEqualTo(201);
        ApiResponse pub = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(pub.json().get("sightings")).isNotEmpty().allSatisfy(s -> assertThat(s.get("contact_phone").isNull()).isTrue());
        assertThat(pub.json().toString()).doesNotContain("3001112233");
        ApiResponse own = owner.get("/cases/{code}", "7K3PQ");
        assertThat(own.str("/sightings/0/contact_phone")).isEqualTo("+573001112233");
    }

    @Test
    void measuredStatementsOnACacheMissForTheFullPathAndTheReplay() {
        accounts.signIn(api, "helper@correo.co");
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse full = post(api, "7K3PQ", json(6.2455, -75.5905, ok(), "+573001112233", ",\"client_id\":\"statements-1\""));
        assertThat(full.statements()).hasSize(10);   // session, case, replay, supported_countries, 2 locks, status, 2 counts, insert
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse replay = post(api, "7K3PQ", json(6.2455, -75.5905, ok(), "+573001112233", ",\"client_id\":\"statements-1\""));
        assertThat(replay.statements()).hasSize(3);   // session, case, replay
    }

}
