package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.db.GeoPoint;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PublishBodies;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.SESSION;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Parity with web/src/mocks/backend.test.ts (line numbers in parentheses). Where the design overrides
 * the mock, the override is named; scenarios ported elsewhere are pointed to.
 * <ul>
 * <li>(113) refuses a body the contract rejects → refusesABodyTheContractRejects</li>
 * <li>(128) unauthorized with nobody signed in → unauthorizedWithNobodySignedIn (listMyCases, as the mock;
 *     also MyCasesEndpointTest.nobodySignedInIsUnauthorized)</li>
 * <li>(134) a stranger gets nothing owner-only → aStrangerGetsNothingOwnerOnly — open_claim_count is 0
 *     (no claims in the slice; the mock seeds one); the public radius is floored at 200 m (the server applies the floor)</li>
 * <li>(145) the owner gets all of it → theOwnerGetsAllOfIt — no claims in the slice</li>
 * <li>(167) gone / not_found → goneAndNotFound</li>
 * <li>(174) feed local around Medellín, newest first → withoutAPointTheFeedIsNational + nearMedellinTheFeedIsLocalNearestFirst —
 *     no point = national (contract feed.ts; the mock substituted Medellín); with a point, nearest band then newest
 *     (design, product/02 "proximity + recency")</li>
 * <li>(191) national fallback → FeedEndpointTest.nothingNearFallsBackToTheWholeCountry</li>
 * <li>(215) a sighting is visible at once → aSightingIsVisibleAtOnce — no notification (not in the slice)</li>
 * <li>(229) the three refusals → refusals</li>
 * <li>(237) five per reporter per case a day → fivePerReporterPerCaseADay</li>
 * <li>(244) «otra vez» inside the correction window → againInsideTheCorrectionWindow</li>
 * <li>(252) client_id replay → aReplayIsTheSameSighting — the replay is answered before the rate limits (and
 *     before every other check), so it still answers the same sighting after the limit is reached</li>
 * <li>(264) not on a closed case → notOnAClosedCase</li>
 * <li>(286) SMS code first, then into the feed → asksForTheSmsCodeFirstThenPublishesIntoTheFeed —
 *     place_name is the generic label (reverse_geocoding off), not «Laureles»; /me/cases checked, /me/pets not in the slice</li>
 * <li>(312) active_case_exists → PublishLostTest.aSecondActiveCaseForTheSamePetNamesTheOpenOne (pet id from the DB)</li>
 * <li>(322) phone_required → PublishLostTest.noNumberAnywhereIsPhoneRequired</li>
 * <li>(1616, 1625) mine for fifteen minutes / not for others → CaseEndpointTest.theDeviceThatReportedSeesItsPinAsMine
 *     (and SightingEndpointTest.anAnonymousSightingIsVisibleAtOnceAndKeyedToTheDevice)</li>
 * <li>(1905) phone changes only after the SMS code → PhoneEndpointsTest.changesThePhoneOnlyAfterTheSmsCode</li>
 * <li>(2095–2130) photo uploads → UploadsTest — ports use purpose sighting: anonymous pet slots are refused (design · Photos);
 *     UploadsTest.petAndProfileSlotsNeedASession covers the refusal</li>
 * </ul>
 * Behaviour that changed after the plan was written, and is asserted as built: the client_id replay comes
 * before the rate limits, and an absent note or contact_phone is validation_failed (null is fine).
 * <p>
 * Not in this slice (scenarios of the mock with no endpoint here): (156) found custodian detail and ownership claims;
 * (331) owner closes the case; (343) close once; (356) starring a pin notifies its reporter; (368) reopening an expired case;
 * (385, 425, 443) claims and check-ins; (457, 492) found claims and matching; (572–794) adoption; help; (1252, 1729–1793)
 * evidence photos and case corrections; (1925) profile photo; notifications and nearby alerts.
 */
@IntegrationTest
class LostParityTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired RecordingSmsSender sms;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;

    ApiClient api;
    UUID carolina;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        carolina = accounts.person("carolina@correo.co");
        cases.luna(carolina);
        var t = clock.instant();
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(7200), t.minusSeconds(7200),
                accounts.person("andres@correo.co"), "3".repeat(64), "+573114829017", "hidden_by_owner");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(5400), t.minusSeconds(5400),
                null, "4".repeat(64), "+573001112233", "visible");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(3600), t.minusSeconds(3600),
                null, "5".repeat(64), null, "visible");
    }

    private ApiResponse sighting(ApiClient as, String note, String extra) {
        String body = """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":%s,"contact_phone":null%s}"""
                .formatted(clock.instant(), note == null ? "null" : "\"" + note + "\"", extra);
        return as.post("/cases/{code}/sightings", body, "7K3PQ");
    }

    private ApiResponse sighting(ApiClient as, String extra) {
        return sighting(as, null, extra);
    }

    private List<String> codes(ApiResponse r) {
        List<String> out = new ArrayList<>();
        r.json().get("items").forEach(i -> out.add(i.get("code").asString()));
        return out;
    }

    /** A session for an existing person (Accounts.signIn creates a new one; here Luna's owner already exists). */
    private String sessionFor(UUID person) {
        String token = Hashing.randomToken(32);
        var now = clock.instant().atOffset(ZoneOffset.UTC);
        db.insertInto(SESSION).set(SESSION.TOKEN_HASH, Hashing.sha256Hex(token)).set(SESSION.PERSON_ID, person)
          .set(SESSION.CREATED_AT, now).set(SESSION.EXPIRES_AT, now.plusMonths(12)).execute();
        return token;
    }

    @Test
    void refusesABodyTheContractRejects() {                                  // (113)
        ApiResponse r = api.post("/cases/{code}/sightings",
                "{\"point\":{\"lat\":200,\"lng\":0},\"seen_at\":\"ayer\",\"note\":null,\"contact_phone\":null}", "7K3PQ");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void unauthorizedWithNobodySignedIn() {                                  // (128)
        assertThat(api.get("/me/cases").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aStrangerGetsNothingOwnerOnly() {                                   // (134)
        ApiResponse luna = api.get("/cases/{code}", "7K3PQ");
        assertThat(luna.str("/viewer")).isEqualTo("public");
        assertThat(luna.json().get("claims")).isEmpty();
        assertThat(luna.json().get("open_claim_count").asInt()).isZero();       // override: no claims in the slice (the mock seeds one)
        assertThat(luna.json().at("/last_seen/radius_m").asDouble()).isEqualTo(200.0);   // override: floor applied by the server
        assertThat(luna.json().get("sightings")).hasSize(2);
        luna.json().get("sightings").forEach(s -> assertThat(s.get("contact_phone").isNull()).isTrue());
        assertThat(luna.isNull("/pending_checkin")).isTrue();
    }

    @Test
    void theOwnerGetsAllOfIt() {                                             // (145)
        ApiClient owner = clients.newBrowser();
        owner.setCookie("__Host-session", sessionFor(carolina));
        ApiResponse luna = owner.get("/cases/{code}", "7k3pq");
        assertThat(luna.str("/viewer")).isEqualTo("owner");
        assertThat(luna.json().get("claims")).isEmpty();                        // override: no claims in the slice
        assertThat(luna.json().at("/last_seen/radius_m").asDouble()).isEqualTo(100.0);
        assertThat(luna.json().get("sightings")).filteredOn(s -> s.get("hidden").asBoolean()).hasSize(1);
        assertThat(luna.json().get("sightings")).anyMatch(s -> !s.get("contact_phone").isNull());
    }

    @Test
    void goneAndNotFound() {                                                 // (167)
        cases.purge("GONE5");
        assertThat(api.get("/cases/{code}", "GONE5").errorCode()).isEqualTo("gone");
        assertThat(api.get("/cases/{code}", "ZZZZZ").errorCode()).isEqualTo("not_found");
    }

    @Test
    void withoutAPointTheFeedIsNational() {                                  // (174) override: national, not Medellín
        cases.lostCase(carolina, "M2TQ4", "Max", "dog", new GeoPoint(6.25, -75.57), 300, "active", clock.instant().minusSeconds(3600));
        cases.lostCase(carolina, "H4PPY", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "reunited", clock.instant().minusSeconds(60));
        ApiResponse feed = api.get("/feed");
        assertThat(feed.str("/scope")).isEqualTo("national");
        assertThat(codes(feed)).containsExactly("M2TQ4", "7K3PQ");              // newest first, open only
    }

    @Test
    void nearMedellinTheFeedIsLocalNearestFirst() {                          // (174) override: nearest band, then newest
        cases.lostCase(carolina, "M2TQ4", "Max", "dog", new GeoPoint(6.30, -75.57), 300, "active", clock.instant().minusSeconds(3600));
        ApiResponse feed = api.get("/feed?lat={lat}&lng={lng}", 6.2442, -75.5812);
        assertThat(feed.str("/scope")).isEqualTo("local");
        assertThat(codes(feed)).containsExactly("7K3PQ", "M2TQ4");              // Luna is at the center: nearest band
    }

    @Test
    void aSightingIsVisibleAtOnce() {                                        // (215) override: no notification in the slice
        assertThat(sighting(api, "En la 70", "").status()).isEqualTo(201);
        ApiResponse luna = api.get("/cases/{code}", "7K3PQ");
        assertThat(luna.json().get("sightings")).hasSize(3);
        assertThat(luna.str("/sightings/2/note")).isEqualTo("En la 70");
        assertThat(luna.json().at("/sightings/2/mine").asBoolean()).isTrue();
    }

    @Test
    void refusals() {                                                        // (229)
        assertThat(api.post("/cases/{code}/sightings", """
                {"point":{"lat":4.711,"lng":-74.0721},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant()), "7K3PQ")
                .errorCode()).isEqualTo("sighting_too_far");
        assertThat(api.post("/cases/{code}/sightings", """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant().plus(Duration.ofHours(1))), "7K3PQ")
                .errorCode()).isEqualTo("seen_at_in_future");
        assertThat(api.post("/cases/{code}/sightings", """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant().minus(Duration.ofDays(4))), "7K3PQ")
                .errorCode()).isEqualTo("seen_at_before_case");
    }

    @Test
    void fivePerReporterPerCaseADay() {                                      // (237)
        for (int i = 0; i < 5; i++) assertThat(sighting(api, "").status()).isEqualTo(201);
        assertThat(sighting(api, "").errorCode()).isEqualTo("rate_limited");
        clock.advance(Duration.ofHours(25));
        assertThat(sighting(api, "").status()).isEqualTo(201);
    }

    @Test
    void againInsideTheCorrectionWindow() {                                  // (244)
        assertThat(sighting(api, "").status()).isEqualTo(201);
        clock.advance(Duration.ofSeconds(60));
        assertThat(sighting(api, "").status()).isEqualTo(201);
    }

    @Test
    void aReplayIsTheSameSighting() {                                        // (252)
        String first = sighting(api, ",\"client_id\":\"c0ffee-replay-1\"").str("/id");
        clock.advance(Duration.ofSeconds(60));
        assertThat(sighting(api, ",\"client_id\":\"c0ffee-replay-1\"").str("/id")).isEqualTo(first);
        assertThat(sighting(api, ",\"client_id\":\"c0ffee-replay-2\"").str("/id")).isNotEqualTo(first);
        assertThat(api.get("/cases/{code}", "7K3PQ").json().get("sightings")).hasSize(4);
        // Changed after the plan: the replay is answered before the rate limits. Fill the limit, then replay.
        for (int i = 0; i < 3; i++) assertThat(sighting(api, "").status()).isEqualTo(201);
        assertThat(sighting(api, "").errorCode()).isEqualTo("rate_limited");
        ApiResponse replay = sighting(api, ",\"client_id\":\"c0ffee-replay-1\"");
        assertThat(replay.status()).isEqualTo(201);
        assertThat(replay.str("/id")).isEqualTo(first);
    }

    @Test
    void absentNoteOrContactPhoneIsValidationFailed() {                      // changed after the plan (contract: required, nullable)
        String body = """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s"}""".formatted(clock.instant());
        assertThat(api.post("/cases/{code}/sightings", body, "7K3PQ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void notOnAClosedCase() {                                                // (264)
        cases.lostCase(carolina, "H4PPY", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "reunited", clock.instant().minusSeconds(86_400));
        ApiResponse r = api.post("/cases/{code}/sightings", """
                {"point":{"lat":6.25,"lng":-75.59},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant()), "H4PPY");
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
    }

    @Test
    void asksForTheSmsCodeFirstThenPublishesIntoTheFeed() {                  // (286)
        ApiClient ana = clients.newBrowser();
        accounts.signIn(ana, "ana.gomez@correo.co");
        String phone = "+573007152284";
        assertThat(ana.post("/lost-cases", PublishBodies.kira(phone, null)).str("/phone_step")).isEqualTo("otp");
        String wrong = sms.lastCodeFor(phone).equals("000000") ? "111111" : "000000";
        assertThat(ana.post("/lost-cases", PublishBodies.kira(phone, wrong)).errorCode()).isEqualTo("invalid_code");
        String code = ana.post("/lost-cases", PublishBodies.kira(phone, sms.lastCodeFor(phone))).str("/code");
        ApiResponse feed = api.get("/feed");
        assertThat(feed.str("/items/0/code")).isEqualTo(code);
        assertThat(feed.str("/items/0/title")).isEqualTo("Kira");
        assertThat(feed.str("/items/0/place_name")).isEqualTo("Zona marcada en el mapa");   // override: reverse_geocoding off
        assertThat(ana.get("/me/cases").str("/0/code")).isEqualTo(code);
    }
}
