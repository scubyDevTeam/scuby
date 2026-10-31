package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
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

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class FeedEndpointTest {

    // Distances from Medellín's center (6.2442, -75.5812): ~1 km, ~4 km, ~20 km; Bogotá ~240 km.
    static final GeoPoint ONE_KM = new GeoPoint(6.2532, -75.5812);
    static final GeoPoint FOUR_KM = new GeoPoint(6.2802, -75.5812);
    static final GeoPoint TWENTY_KM = new GeoPoint(6.4242, -75.5812);
    static final GeoPoint BOGOTA = new GeoPoint(4.711, -74.0721);

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient api;
    UUID owner;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        owner = accounts.person("owner@correo.co");
    }

    private Instant daysAgo(int d) {
        return MutableClock.START.minusSeconds(d * 86_400L);
    }

    private List<String> codes(ApiResponse r) {
        List<String> out = new ArrayList<>();
        r.json().get("items").forEach(i -> out.add(i.get("code").asString()));
        return out;
    }

    @Test
    void withoutAPointTheFeedIsNationalNewestFirstOpenCasesOnly() {
        cases.lostCase(owner, "AAAA2", "Uno", "dog", ONE_KM, 300, "active", daysAgo(3));
        cases.lostCase(owner, "BBBB2", "Dos", "dog", BOGOTA, 300, "active", daysAgo(1));
        cases.lostCase(owner, "CCCC2", "Tres", "dog", FOUR_KM, 300, "expired", daysAgo(0));
        ApiResponse r = api.get("/feed");
        assertThat(r.str("/scope")).isEqualTo("national");
        assertThat(codes(r)).containsExactly("BBBB2", "AAAA2");
    }

    @Test
    void nearAPointTheNearestBandComesFirstThenTheNewest() {
        cases.lostCase(owner, "NEAR2", "Cerca", "dog", ONE_KM, 300, "active", daysAgo(10));
        cases.lostCase(owner, "MID22", "Medio", "dog", FOUR_KM, 300, "active", daysAgo(1));
        cases.lostCase(owner, "MID33", "Medio2", "dog", FOUR_KM, 300, "active", daysAgo(2));
        cases.lostCase(owner, "FAR22", "Lejos", "dog", TWENTY_KM, 300, "active", daysAgo(0));
        cases.lostCase(owner, "BOG22", "Bogotá", "dog", BOGOTA, 300, "active", daysAgo(0));
        ApiResponse r = api.get("/feed?lat={lat}&lng={lng}", 6.2442, -75.5812);
        assertThat(r.str("/scope")).isEqualTo("local");
        assertThat(codes(r)).containsExactly("NEAR2", "MID22", "MID33", "FAR22");
    }

    // Port of backend.test.ts «falls back to the whole country when nothing is near».
    @Test
    void nothingNearFallsBackToTheWholeCountry() {
        cases.lostCase(owner, "NEAR2", "Cerca", "dog", ONE_KM, 300, "active", daysAgo(1));
        ApiResponse r = api.get("/feed?lat={lat}&lng={lng}", 4.711, -74.0721);
        assertThat(r.str("/scope")).isEqualTo("national");
        assertThat(codes(r)).containsExactly("NEAR2");
    }

    @Test
    void filtersApplyBeforeTheScopeIsDecided() {
        cases.lostCase(owner, "DOG22", "Perro", "dog", ONE_KM, 300, "active", daysAgo(1));
        cases.lostCase(owner, "CAT22", "Gato", "cat", BOGOTA, 300, "active", daysAgo(1));
        ApiResponse r = api.get("/feed?lat={lat}&lng={lng}&species=cat", 6.2442, -75.5812);
        assertThat(r.str("/scope")).isEqualTo("national");
        assertThat(codes(r)).containsExactly("CAT22");
        assertThat(api.get("/feed?vertical=found").json().get("items")).isEmpty();
        assertThat(codes(api.get("/feed?vertical=lost"))).containsExactlyInAnyOrder("DOG22", "CAT22");
    }

    @Test
    void anItemCarriesTheCardFields() {
        cases.lostCase(owner, "LUNA2", "Luna", "cat", ONE_KM, 100, "active", daysAgo(1));
        cases.sighting("LUNA2", ONE_KM, daysAgo(0).minusSeconds(3600), daysAgo(0).minusSeconds(3600), null, "3".repeat(64), null, "visible");
        cases.sighting("LUNA2", ONE_KM, daysAgo(0).minusSeconds(60), daysAgo(0).minusSeconds(60), null, "3".repeat(64), null, "hidden_by_owner");
        ApiResponse r = api.get("/feed");
        assertThat(r.str("/items/0/title")).isEqualTo("Luna");
        assertThat(r.str("/items/0/summary")).isEqualTo("Gato · Pequeño · Negro y canela");
        assertThat(r.str("/items/0/place_name")).isEqualTo("Zona marcada en el mapa");
        assertThat(r.json().at("/items/0/point/lat").asDouble()).isEqualTo(ONE_KM.lat());
        assertThat(r.json().at("/items/0/sightings_count").asInt()).isEqualTo(1);
        assertThat(r.str("/items/0/last_sighting_at")).isEqualTo("2026-10-14T16:00:00Z");
        assertThat(r.json().at("/items/0/possible_find").asBoolean()).isFalse();
        assertThat(r.isNull("/items/0/detail")).isTrue();
        assertThat(r.str("/items/0/photo_url")).endsWith(".jpg");
    }

    @Test
    void atMostOneHundredItemsAndTheStatementCountDoesNotGrow() {
        for (int i = 0; i < 105; i++) {
            cases.lostCase(owner, "Z%04d".formatted(i), "P" + i, "dog", BOGOTA, 300, "active", daysAgo(1).plusSeconds(i));
        }
        ApiResponse r = api.get("/feed?lat={lat}&lng={lng}", 6.2442, -75.5812);   // ceiling enforced by ApiClient
        assertThat(r.json().get("items")).hasSize(100);
        assertThat(codes(r).getFirst()).isEqualTo("Z0104");
    }

    @Test
    void aBadQueryIsValidationFailed() {
        assertThat(api.get("/feed?lat={lat}&lng={lng}", 200, 0).errorCode()).isEqualTo("validation_failed");
        assertThat(api.get("/feed?species=dragon").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void malformedAndOutOfRangeCoordinatesAreValidationFailedNeverA500() {
        for (String q : List.of("lat=abc&lng=0", "lat=0&lng=abc", "lat=-90.1&lng=0", "lat=0&lng=180.1", "lat=0&lng=-180.1",
                "lat=NaN&lng=0", "lat=Infinity&lng=0", "vertical=bogus")) {
            assertThat(api.get("/feed?" + q).errorCode()).as(q).isEqualTo("validation_failed");
        }
    }

    @Test
    void onlyOneOfLatLngIsTheNationalFeed() {
        cases.lostCase(owner, "NEAR2", "Cerca", "dog", ONE_KM, 300, "active", daysAgo(1));
        for (String q : List.of("lat=6.2442", "lng=-75.5812")) {
            ApiResponse r = api.get("/feed?" + q);
            assertThat(r.str("/scope")).as(q).isEqualTo("national");
            assertThat(codes(r)).as(q).containsExactly("NEAR2");
        }
    }

    // Inside one band recency beats distance: plain nearest-first ordering would put NEWER_FARTHER last.
    @Test
    void insideABandTheNewerCaseComesFirstEvenWhenFarther() {
        cases.lostCase(owner, "OLDNR", "Viejo", "dog", northOf(CENTER, 500), 300, "active", daysAgo(5));
        cases.lostCase(owner, "NEWFR", "Nuevo", "dog", northOf(CENTER, 1_800), 300, "active", daysAgo(1));
        assertThat(codes(local())).containsExactly("NEWFR", "OLDNR");
    }

    @Test
    void bandEdgesAreInclusiveJustInsideAndExclusiveJustOutside() {
        // Each "in" point is 10 m inside a threshold, each "out" point 10 m past it; every band holds recency
        // opposite to band order, so a wrong threshold changes the order.
        cases.lostCase(owner, "B2OUT", "a", "dog", northOf(CENTER, 2_010), 300, "active", daysAgo(0));
        cases.lostCase(owner, "B2IN2", "b", "dog", northOf(CENTER, 1_990), 300, "active", daysAgo(9));
        cases.lostCase(owner, "B5OUT", "c", "dog", northOf(CENTER, 5_010), 300, "active", daysAgo(1));
        cases.lostCase(owner, "B5IN2", "d", "dog", northOf(CENTER, 4_990), 300, "active", daysAgo(8));
        cases.lostCase(owner, "B10OT", "e", "dog", northOf(CENTER, 10_010), 300, "active", daysAgo(2));
        cases.lostCase(owner, "B10IN", "f", "dog", northOf(CENTER, 9_990), 300, "active", daysAgo(7));
        cases.lostCase(owner, "C25IN", "g", "dog", northOf(CENTER, 24_990), 300, "active", daysAgo(3));
        cases.lostCase(owner, "C25OT", "h", "dog", northOf(CENTER, 25_010), 300, "active", daysAgo(0));
        ApiResponse r = local();
        assertThat(r.str("/scope")).isEqualTo("local");
        // band 0: B2IN2; band 1 (2-5 km): B2OUT(newest) then B5IN2; band 2 (5-10 km): B5OUT then B10IN; band 3: B10OT, C25IN.
        assertThat(codes(r)).containsExactly("B2IN2", "B2OUT", "B5IN2", "B5OUT", "B10IN", "B10OT", "C25IN");
    }

    @Test
    void equalPublishedAtIsOrderedByCodeSoTheOrderIsDeterministic() {
        Instant same = daysAgo(2);
        for (String code : List.of("CCCC2", "AAAA2", "BBBB2")) {
            cases.lostCase(owner, code, "Pet" + code, "dog", ONE_KM, 300, "active", same);
        }
        assertThat(codes(api.get("/feed"))).containsExactly("AAAA2", "BBBB2", "CCCC2");
        assertThat(codes(local())).containsExactly("AAAA2", "BBBB2", "CCCC2");
    }

    @Test
    void atMostOneHundredItemsOnALocalHitToo() {
        for (int i = 0; i < 105; i++) {
            cases.lostCase(owner, "L%04d".formatted(i), "P" + i, "dog", ONE_KM, 300, "active", daysAgo(1).plusSeconds(i));
        }
        ApiResponse r = local();
        assertThat(r.str("/scope")).isEqualTo("local");
        assertThat(r.json().get("items")).hasSize(100);
        assertThat(codes(r).getFirst()).isEqualTo("L0104");
    }

    static final GeoPoint CENTER = new GeoPoint(6.2442, -75.5812);

    private ApiResponse local() {
        return api.get("/feed?lat={lat}&lng={lng}", CENTER.lat(), CENTER.lng());
    }

    /** A point {@code meters} due north of {@code from} on the same meridian (WGS84 meridian radius at the midpoint). */
    static GeoPoint northOf(GeoPoint from, double meters) {
        double a = 6_378_137.0, e2 = 0.00669437999014;
        double lat = from.lat();
        for (int i = 0; i < 3; i++) {   // refine with the radius at the midpoint latitude
            double mid = Math.toRadians((from.lat() + lat) / 2);
            double m = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(mid) * Math.sin(mid), 1.5);
            lat = from.lat() + Math.toDegrees(meters / m);
        }
        return new GeoPoint(lat, from.lng());
    }

    /** Leak test (decision 63): a feed item's point is the snapped center, the same on every request, never the exact one. */
    @Test
    void feedPointsAreSnappedAndStable() {
        cases.lostCase(owner, "AAAA2", "Uno", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(1));
        ApiResponse first = api.get("/feed");
        ApiResponse second = clients.newBrowser().get("/feed");
        assertThat(first.json().at("/items/0/point/lat").asDouble()).isEqualTo(6.2442);
        assertThat(first.json().at("/items/0/point/lng").asDouble()).isEqualTo(-75.580392);
        assertThat(second.json().at("/items/0/point")).isEqualTo(first.json().at("/items/0/point"));
        assertThat(first.body()).doesNotContain("-75.5812");
        // a signed-in caller gets the same feed point: the feed is a public view
        ApiClient signedIn = clients.newBrowser();
        accounts.signIn(signedIn, "other@correo.co");
        assertThat(signedIn.get("/feed").json().at("/items/0/point")).isEqualTo(first.json().at("/items/0/point"));
    }
}
