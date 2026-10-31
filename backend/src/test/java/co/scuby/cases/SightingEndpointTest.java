package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.db.GeoPoint;
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
import org.springframework.http.HttpMethod;

import java.time.Duration;
import java.util.UUID;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class SightingEndpointTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        cases.luna(accounts.person("carolina@correo.co"));
    }

    static String body(String seenAt, String extra) {
        return """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null,"contact_phone":null%s}""".formatted(seenAt, extra);
    }

    private ApiResponse report(ApiClient as, String extra) {
        return as.post("/cases/{code}/sightings", body(clock.instant().toString(), extra), "7K3PQ");
    }

    @Test
    void anAnonymousSightingIsVisibleAtOnceAndKeyedToTheDevice() {
        ApiResponse r = report(api, "");
        assertThat(r.status()).isEqualTo(201);
        UUID id = UUID.fromString(r.str("/id"));
        var row = db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(id)).fetchOne();
        assertThat(row.getStatus()).isEqualTo("visible");
        assertThat(row.getReporterPersonId()).isNull();
        assertThat(row.getReporterDeviceHash()).isEqualTo(Hashing.sha256Hex(api.cookie("device").orElseThrow()));
        ApiResponse luna = api.get("/cases/{code}", "7K3PQ");
        assertThat(luna.json().at("/sightings/0/mine").asBoolean()).isTrue();
        assertThat(luna.str("/sightings/0/editable_until")).isEqualTo("2026-10-14T17:15:00Z");
    }

    @Test
    void aSignedInReporterIsTheAccount() {
        UUID me = accounts.signIn(api, "helper@correo.co");
        UUID id = UUID.fromString(report(api, "").str("/id"));
        assertThat(db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(id)).fetchOne().getReporterPersonId()).isEqualTo(me);
    }

    @Test
    void aReplayIsTheSameSightingBeforeAnyCheckEvenOnAClosedCase() {
        String first = report(api, ",\"client_id\":\"c0ffee-replay-1\"").str("/id");
        db.execute("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        ApiResponse again = clients.newBrowser().post("/cases/{code}/sightings",
                body(clock.instant().toString(), ",\"client_id\":\"c0ffee-replay-1\""), "7K3PQ");
        assertThat(again.status()).isEqualTo(201);
        assertThat(again.str("/id")).isEqualTo(first);
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
    }

    @Test
    void unknownAndPurgedCodesAreNotFoundAndAClosedCaseIsInvalidTransition() {
        cases.purge("GONE5");
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().toString(), ""), "ZZZZZ").errorCode()).isEqualTo("not_found");
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().toString(), ""), "GONE5").errorCode()).isEqualTo("not_found");
        db.execute("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        assertThat(report(api, "").errorCode()).isEqualTo("invalid_transition");
    }

    @Test
    void timeAndDistanceRulesWithFiveMinutesOfClockDrift() {
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().plusSeconds(240).toString(), ""), "7K3PQ").status()).isEqualTo(201);
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().plusSeconds(360).toString(), ""), "7K3PQ").errorCode()).isEqualTo("seen_at_in_future");
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().minus(Duration.ofDays(4)).toString(), ""), "7K3PQ").errorCode()).isEqualTo("seen_at_before_case");
        String bogota = """
                {"point":{"lat":4.711,"lng":-74.0721},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant());
        assertThat(api.post("/cases/{code}/sightings", bogota, "7K3PQ").errorCode()).isEqualTo("sighting_too_far");
    }

    @Test
    void noteAndContactPhoneAreRequiredButMayBeNull() {
        String noNote = """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","contact_phone":null}""".formatted(clock.instant());
        String noPhone = """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null}""".formatted(clock.instant());
        ApiResponse missingNote = api.post("/cases/{code}/sightings", noNote, "7K3PQ");
        ApiResponse missingPhone = api.post("/cases/{code}/sightings", noPhone, "7K3PQ");
        assertThat(missingNote.errorCode()).isEqualTo("validation_failed");
        assertThat(missingNote.json().at("/error/fields").has("note")).as(missingNote.body()).isTrue();
        assertThat(missingPhone.errorCode()).isEqualTo("validation_failed");
        assertThat(missingPhone.json().at("/error/fields").has("contact_phone")).as(missingPhone.body()).isTrue();
        assertThat(db.fetchCount(SIGHTING)).isZero();
        assertThat(report(api, "").status()).isEqualTo(201);   // explicit nulls are fine
    }

    @Test
    void aContactPhoneMustBeASupportedMobile() {
        String withLandline = body(clock.instant().toString(), "").replace("\"contact_phone\":null", "\"contact_phone\":\"+5716012345\"");
        ApiResponse r = api.post("/cases/{code}/sightings", withLandline, "7K3PQ");
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("contact_phone")).isTrue();
    }

    @Test
    void photosMustBeThisCallersProcessedSightingUploads() {
        byte[] bytes = "pin-photo".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        String url = api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        String withPhoto = ",\"photo_urls\":[\"" + url + "\"]";
        ApiResponse stranger = report(clients.newBrowser(), withPhoto);
        assertThat(stranger.json().at("/error/fields").has("photo_urls")).isTrue();
        assertThat(report(api, withPhoto).status()).isEqualTo(201);
    }

    @Test
    void fivePerReporterPerCaseADayAndTheAccountIsTheKeyWhenSignedIn() {
        for (int i = 0; i < 5; i++) assertThat(report(api, "").status()).isEqualTo(201);
        assertThat(report(api, "").errorCode()).isEqualTo("rate_limited");
        accounts.signIn(api, "helper@correo.co");                 // same device, now an account: a different reporter
        assertThat(report(api, "").status()).isEqualTo(201);
        clock.advance(Duration.ofHours(25));
        assertThat(report(clients.newBrowser(), "").status()).isEqualTo(201);
    }

    @Test
    void twentyPerReporterOverall() {
        UUID owner = accounts.person("owner2@correo.co");
        for (int c = 0; c < 4; c++) {
            String code = cases.lostCase(owner, "R%04d".formatted(c), "P" + c, "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600));
            for (int i = 0; i < 5; i++) {
                assertThat(api.post("/cases/{code}/sightings", body(clock.instant().toString(), ""), code).status()).isEqualTo(201);
            }
        }
        assertThat(report(api, "").errorCode()).isEqualTo("rate_limited");
    }

    @Test
    void theIpIsASecondKeyAcrossDevices() {
        for (int i = 0; i < 20; i++) {
            assertThat(report(clients.newBrowser().from("198.51.100.20"), "").status()).isEqualTo(201);
        }
        assertThat(report(clients.newBrowser().from("198.51.100.20"), "").errorCode()).isEqualTo("rate_limited");
        assertThat(report(clients.newBrowser().from("198.51.100.21"), "").status()).isEqualTo(201);
    }

    @Test
    void theStatementCeilingHoldsOnTheFullPath() {
        byte[] bytes = "pin-photo-2".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        accounts.signIn(api, "helper@correo.co");
        String url = api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        String full = body(clock.instant().toString(), ",\"photo_urls\":[\"" + url + "\"],\"client_id\":\"full-path-1\"")
                .replace("\"contact_phone\":null", "\"contact_phone\":\"+573001112233\"");
        caches.orderedStream().filter(c -> c.getClass().getSimpleName().equals("CachingSessionLookup")).forEach(ClearableCache::clear);
        ApiResponse r = api.post("/cases/{code}/sightings", full, "7K3PQ");
        assertThat(r.status()).isEqualTo(201);
        // session, case, replay, supported_countries, upload lookup, 2 locks, status, 2 counts, insert
        assertThat(r.statements()).hasSize(11);
    }
}
