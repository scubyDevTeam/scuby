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
}
