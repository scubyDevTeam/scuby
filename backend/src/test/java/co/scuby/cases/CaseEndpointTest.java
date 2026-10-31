package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
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
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class CaseEndpointTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired LostCaseQueries queries;

    ApiClient owner;
    UUID carolina;

    @BeforeEach
    void setUp() {
        testDb.reset();
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        cases.luna(carolina);
        UUID helper = accounts.person("helper@correo.co");
        var t = MutableClock.START;
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(7200), t.minusSeconds(7200), helper, "3".repeat(64), "+573001112233", "visible");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(3600), t.minusSeconds(3600), null, "4".repeat(64), "+573004445566", "hidden_by_owner");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(600), t.minusSeconds(600), null, "5".repeat(64), null, "visible");
    }

    /** Leak test (design · guardrail 6): as a non-owner, every owner-only field is null or empty. */
    private void assertNothingOwnerOnly(ApiResponse r) {
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/viewer")).isEqualTo("public");
        assertThat(r.json().get("claims")).isEmpty();
        assertThat(r.isNull("/pending_checkin")).isTrue();
        assertThat(r.json().at("/last_seen/radius_m").asDouble()).isEqualTo(200.0);
        assertThat(r.json().get("sightings")).hasSize(2);
        r.json().get("sightings").forEach(s -> {
            assertThat(s.get("contact_phone").isNull()).isTrue();
            assertThat(s.get("hidden").asBoolean()).isFalse();
        });
    }

    @Test
    void anAnonymousStrangerGetsNothingOwnerOnly() {
        assertNothingOwnerOnly(clients.newBrowser().get("/cases/{code}", "7K3PQ"));
    }

    @Test
    void aSignedInStrangerGetsNothingOwnerOnly() {
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        assertNothingOwnerOnly(stranger.get("/cases/{code}", "7K3PQ"));
    }

    @Test
    void theOwnerGetsAllOfItAndTheCodeIsCaseInsensitive() {
        ApiResponse r = owner.get("/cases/{code}", "7k3pq");
        assertThat(r.str("/viewer")).isEqualTo("owner");
        assertThat(r.json().at("/last_seen/radius_m").asDouble()).isEqualTo(100.0);
        assertThat(r.json().get("sightings")).hasSize(3);
        assertThat(r.str("/sightings/0/contact_phone")).isEqualTo("+573001112233");
        assertThat(r.json().at("/sightings/1/hidden").asBoolean()).isTrue();
        assertThat(r.str("/contact/whatsapp_url")).isEqualTo("https://wa.me/573114829017");
        assertThat(r.str("/contact/display_name")).isEqualTo("carolina");
    }

    @Test
    void theDeviceThatReportedSeesItsPinAsMine() {
        ApiClient reporter = clients.newBrowser();
        reporter.get("/config");   // receives a device cookie
        String device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, MutableClock.START.minusSeconds(60), MutableClock.START.minusSeconds(60), null, device, null, "visible");
        ApiResponse r = reporter.get("/cases/{code}", "7K3PQ");
        assertThat(r.str("/sightings/2/editable_until")).isEqualTo("2026-10-14T17:14:00Z");
        assertThat(r.json().at("/sightings/2/mine").asBoolean()).isTrue();
        assertThat(r.json().at("/sightings/0/mine").asBoolean()).isFalse();
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().get("sightings"))
                .allSatisfy(s -> assertThat(s.get("mine").asBoolean()).isFalse());
    }

    @Test
    void aPurgedCodeIsGoneAndAnUnknownOneNotFound() {
        cases.purge("GONE5");
        assertThat(clients.newBrowser().get("/cases/{code}", "GONE5").errorCode()).isEqualTo("gone");
        assertThat(clients.newBrowser().get("/cases/{code}", "ZZZZZ").errorCode()).isEqualTo("not_found");
        assertThat(clients.newBrowser().get("/cases/{code}", "not-a-code").errorCode()).isEqualTo("not_found");
    }

    /** Leak test: a number the publisher did not expose is not on the wire (and not even loaded: LostCaseQueries.WHATSAPP_PHONE). */
    @Test
    void anUnexposedNumberGivesNoWhatsappUrl() {
        cases.lostCase(carolina, "N0WA2", "Kira", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600));
        db.execute("UPDATE scuby.lost_case SET expose_whatsapp = false WHERE code = 'N0WA2'");
        for (ApiClient viewer : List.of(clients.newBrowser(), owner)) {
            ApiResponse r = viewer.get("/cases/{code}", "N0WA2");
            assertThat(r.isNull("/contact/whatsapp_url")).isTrue();
            assertThat(r.body()).doesNotContain(CaseFixtures.LUNA_PHONE.substring(1));
        }
    }

    @Test
    void aClosedCaseStillResolvesWithoutContact() {
        cases.lostCase(carolina, "H4PPY", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "reunited", MutableClock.START.minusSeconds(5 * 86_400));
        ApiResponse r = clients.newBrowser().get("/cases/{code}", "H4PPY");
        assertThat(r.str("/status")).isEqualTo("reunited");
        assertThat(r.isNull("/contact")).isTrue();
        assertThat(r.str("/resolved_at")).isNotNull();
    }

    @Test
    void theStatementCountDoesNotGrowWithSightings() {
        for (int i = 0; i < 25; i++) {
            cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, MutableClock.START.minusSeconds(100 + i), MutableClock.START.minusSeconds(100 + i), null, "6".repeat(64), null, "visible");
        }
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");    // ApiClient enforces the ceiling (3)
        assertThat(r.json().get("sightings")).hasSize(28);
        assertThat(r.statements()).hasSizeLessThanOrEqualTo(3);
    }

    @Test
    void displayTextFollowsAcceptLanguage() {
        assertThat(clients.newBrowser().header("Accept-Language", "en").get("/cases/{code}", "7K3PQ").str("/last_seen/place_name"))
                .isEqualTo("Area marked on the map");
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").str("/last_seen/place_name"))
                .isEqualTo("Zona marcada en el mapa");
    }

    /** The WhatsApp guard (LostCaseQueries.WHATSAPP_PHONE): a number not on WhatsApp is never a wa.me contact. */
    @Test
    void aNumberWithoutWhatsappIsNeverExposedAsWhatsapp() {
        cases.lostCase(carolina, "N0WA3", "Kira", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600), false);
        assertThat(queries.loadCase("N0WA3").orElseThrow().whatsappPhone()).isNull();
        for (ApiClient viewer : List.of(clients.newBrowser(), owner)) {
            ApiResponse r = viewer.get("/cases/{code}", "N0WA3");
            assertThat(r.isNull("/contact/whatsapp_url")).isTrue();
            assertThat(r.body()).doesNotContain(CaseFixtures.LUNA_PHONE.substring(1));
        }
        // control: the same case with WhatsApp does load and expose it
        cases.lostCase(carolina, "WA0K2", "Kira", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600), true);
        assertThat(queries.loadCase("WA0K2").orElseThrow().whatsappPhone()).isEqualTo(CaseFixtures.LUNA_PHONE);
    }

    /** A case that is not active: the number is not loaded and the response has no contact, even with WhatsApp exposed. */
    @Test
    void aNonActiveCaseNeverLoadsOrExposesTheNumber() {
        cases.lostCase(carolina, "CL0S3", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "reunited", MutableClock.START.minusSeconds(86_400));
        assertThat(queries.loadCase("CL0S3").orElseThrow().whatsappPhone()).isNull();
        for (ApiClient viewer : List.of(clients.newBrowser(), owner)) {
            ApiResponse r = viewer.get("/cases/{code}", "CL0S3");
            assertThat(r.isNull("/contact")).isTrue();
            assertThat(r.body()).doesNotContain(CaseFixtures.LUNA_PHONE.substring(1));
        }
    }

    @Test
    void theOwnersDeviceAfterSignOutIsPublic() {
        owner.get("/cases/{code}", "7K3PQ");   // receives a device cookie
        ApiClient signedOut = clients.newBrowser();
        signedOut.setCookie("device", owner.cookie("device").orElseThrow());
        ApiResponse r = signedOut.get("/cases/{code}", "7K3PQ");
        assertThat(r.str("/viewer")).isEqualTo("public");
        assertThat(r.json().get("sightings")).allSatisfy(s -> assertThat(s.get("contact_phone").isNull()).isTrue());
    }

    @Test
    void aSightingReporterSignedInIsNotTheOwnerAndOnlyTheirOwnPinIsMine() {
        ApiClient helperBrowser = clients.newBrowser();
        UUID reporter = accounts.signIn(helperBrowser, "reporter@correo.co");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, MutableClock.START.minusSeconds(30), MutableClock.START.minusSeconds(30), reporter, "7".repeat(64), null, "visible");
        ApiResponse r = helperBrowser.get("/cases/{code}", "7K3PQ");
        assertThat(r.str("/viewer")).isEqualTo("public");
        assertThat(r.json().at("/sightings/2/mine").asBoolean()).isTrue();
        assertThat(r.json().at("/sightings/0/mine").asBoolean()).isFalse();
        assertThat(r.json().at("/claims")).isEmpty();
    }

    @Test
    void acceptLanguageWithRegionQualityOrUnsupportedTag() {
        assertThat(clients.newBrowser().header("Accept-Language", "en-US").get("/cases/{code}", "7K3PQ").str("/last_seen/place_name"))
                .isEqualTo("Area marked on the map");
        assertThat(clients.newBrowser().header("Accept-Language", "es-CO,es;q=0.9").get("/cases/{code}", "7K3PQ").str("/last_seen/place_name"))
                .isEqualTo("Zona marcada en el mapa");
        assertThat(clients.newBrowser().header("Accept-Language", "fr").get("/cases/{code}", "7K3PQ").str("/last_seen/place_name"))
                .isEqualTo("Zona marcada en el mapa");
    }

    @Test
    void highlightedByOwnerIsPassedThrough() {
        db.execute("UPDATE scuby.sighting SET highlighted_by_owner = true, note = 'junto al parque' WHERE reporter_device_hash = '" + "5".repeat(64) + "'");
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        assertThat(r.json().at("/sightings/2/highlighted_by_owner").asBoolean()).isTrue();
        assertThat(r.str("/sightings/2/note")).isEqualTo("junto al parque");
        assertThat(r.json().at("/sightings/0/highlighted_by_owner").asBoolean()).isFalse();
    }
}
