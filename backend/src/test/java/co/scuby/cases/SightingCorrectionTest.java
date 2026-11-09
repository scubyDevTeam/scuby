package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** «Corregir» (docs/product/04 · Correction window; spec §4.7): the reporter moves their pin inside 15 minutes. */
@IntegrationTest
class SightingCorrectionTest {

    static final Instant NOW = MutableClock.START;
    static final Instant CREATED = NOW.minus(Duration.ofMinutes(5));
    static final String PATH = "/cases/{code}/sightings/{sightingId}/correction";
    static final String GOOD = "{\"point\":{\"lat\":6.25,\"lng\":-75.59},\"seen_at\":\"2026-10-14T16:50:00Z\",\"note\":\"En la esquina\"}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired MutableClock clock;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient reporter;          // anonymous: a device cookie only
    String device;
    UUID carolina;
    UUID pin;
    Contention contention;

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
        carolina = accounts.person("carolina@correo.co");
        cases.luna(carolina);
        reporter = clients.newBrowser();
        reporter.get("/config");
        device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, null, device, "+573001112233", "visible");
        db.update(SIGHTING).set(SIGHTING.PHOTO_URLS, new String[] {"http://localhost/dev-media/" + "b".repeat(64) + ".jpg"})
          .set(SIGHTING.NOTE, "Corría").where(SIGHTING.ID.eq(pin)).execute();
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
    }

    private ApiResponse correct(ApiClient as, String code, Object id, String json) {
        return as.post(PATH, json, code, id);
    }

    private Record row() {
        return db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(pin)).fetchOne();
    }

    private void assertUncorrected() {
        assertThat(row().get(SIGHTING.LAT)).isEqualTo(CaseFixtures.MEDELLIN.lat());
        assertThat(row().get(SIGHTING.NOTE)).isEqualTo("Corría");
    }

    @Test
    void theReporterMovesTheirPinAndItsTimeAndNoteButNotItsPhotosContactOrWindow() {
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD);
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.body()).isEmpty();
        Record s = row();
        assertThat(s.get(SIGHTING.LAT)).isEqualTo(6.25);
        assertThat(s.get(SIGHTING.LNG)).isEqualTo(-75.59);
        assertThat(s.get(SIGHTING.SEEN_AT).toInstant()).isEqualTo(Instant.parse("2026-10-14T16:50:00Z"));
        assertThat(s.get(SIGHTING.NOTE)).isEqualTo("En la esquina");
        assertThat(List.of(s.get(SIGHTING.PHOTO_URLS))).hasSize(1);
        assertThat(s.get(SIGHTING.CONTACT_PHONE)).isEqualTo("+573001112233");
        assertThat(s.get(SIGHTING.CREATED_AT).toInstant()).isEqualTo(CREATED);
        assertThat(reporter.get("/cases/{code}", "7K3PQ").str("/sightings/0/editable_until")).isEqualTo("2026-10-14T17:10:00Z");
        // The contact stays the owner's to read after a correction: the reporter and a stranger see none.
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().at("/sightings/0/contact_phone").isNull()).isTrue();
        assertThat(reporter.get("/cases/{code}", "7K3PQ").json().at("/sightings/0/contact_phone").isNull()).isTrue();
    }

    @Test
    void aNullNoteClearsIt() {
        assertThat(correct(reporter, "7K3PQ", pin, GOOD.replace("\"En la esquina\"", "null")).status()).isEqualTo(204);
        assertThat(row().get(SIGHTING.NOTE)).isNull();
    }

    @Test
    void aSignedInReporterIsMatchedByAccountFromAnyDevice() {
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        assertThat(correct(helper, "7K3PQ", theirs, GOOD).status()).isEqualTo(204);
    }

    @Test
    void anAnonymousPinStaysTheReportersAfterTheySignInOnTheSameBrowser() {
        accounts.signIn(reporter, "andres@correo.co");          // same browser, same device cookie, now signed in
        assertThat(reporter.get("/cases/{code}", "7K3PQ").json().at("/sightings/0/mine").asBoolean()).isTrue();
        assertThat(correct(reporter, "7K3PQ", pin, GOOD).status()).isEqualTo(204);
        assertThat(row().get(SIGHTING.NOTE)).isEqualTo("En la esquina");
    }

    @Test
    void anotherPersonsPinSentFromThisBrowserIsForbidden() {
        UUID laura = accounts.person("laura@correo.co");
        UUID lauras = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, laura, device, null, "visible");   // a shared device
        accounts.signIn(reporter, "andres@correo.co");
        ApiResponse r = correct(reporter, "7K3PQ", lauras, GOOD);
        assertThat(r.status()).isEqualTo(403);
        assertThat(r.errorCode()).isEqualTo("forbidden");
        assertThat(db.select(SIGHTING.NOTE).from(SIGHTING).where(SIGHTING.ID.eq(lauras)).fetchOne(SIGHTING.NOTE)).isNull();
    }

    @Test
    void aSignedInPinIsNotTheDevicesOnceItsReporterSignsOut() {
        UUID andres = accounts.person("andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, device, null, "visible");
        ApiResponse r = correct(reporter, "7K3PQ", theirs, GOOD);   // the same device, no session: a person's pin is that person's
        assertThat(r.errorCode()).isEqualTo("forbidden");
    }

    @Test
    void someoneElsesPinIsForbidden() {
        ApiResponse r = correct(clients.newBrowser(), "7K3PQ", pin, GOOD);
        assertThat(r.status()).isEqualTo(403);
        assertUncorrected();
    }

    @Test
    void aPinTheOwnerHidIsForbiddenToItsReporter() {
        db.update(SIGHTING).set(SIGHTING.STATUS, "hidden_by_owner").where(SIGHTING.ID.eq(pin)).execute();
        assertThat(correct(reporter, "7K3PQ", pin, GOOD).errorCode()).isEqualTo("forbidden");
        assertUncorrected();
    }

    @ParameterizedTest
    @CsvSource({"removed_by_moderation", "deleted_by_reporter"})
    void aModeratedOrDeletedPinIsNotFound(String status) {
        db.update(SIGHTING).set(SIGHTING.STATUS, status).where(SIGHTING.ID.eq(pin)).execute();
        assertThat(correct(reporter, "7K3PQ", pin, GOOD).errorCode()).isEqualTo("not_found");
    }

    @Test
    void anUnknownCodeAnUnknownPinAMalformedIdOrAnotherCasesPinIsNotFound() {
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        assertThat(correct(reporter, "ZZZZZ", pin, GOOD).errorCode()).isEqualTo("not_found");
        assertThat(correct(reporter, "OTH22", pin, GOOD).errorCode()).isEqualTo("not_found");
        assertThat(correct(reporter, "7K3PQ", UUID.randomUUID(), GOOD).errorCode()).isEqualTo("not_found");
        assertThat(correct(reporter, "7K3PQ", "x", GOOD).errorCode()).isEqualTo("not_found");
    }

    @Test
    void aClosedCaseIsInvalidTransition() {
        cases.close("7K3PQ", "reunited", NOW.minusSeconds(60));
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertUncorrected();
    }

    @Test
    void theWindowEndsExclusivelyAtFifteenMinutes() {
        clock.set(CREATED.plus(Duration.ofMinutes(15)).minusMillis(1));
        assertThat(correct(reporter, "7K3PQ", pin, GOOD).status()).isEqualTo(204);
        clock.set(CREATED.plus(Duration.ofMinutes(15)));
        ApiResponse late = correct(reporter, "7K3PQ", pin, GOOD.replace("En la esquina", "Tarde"));
        assertThat(late.status()).isEqualTo(403);
        assertThat(row().get(SIGHTING.NOTE)).isEqualTo("En la esquina");
    }

    @Test
    void eachSightingRuleRefusesItsOwnBody() {
        assertThat(correct(reporter, "7K3PQ", pin, GOOD.replace("2026-10-14T16:50:00Z", "2026-10-14T17:06:00Z")).errorCode())
                .isEqualTo("seen_at_in_future");
        assertThat(correct(reporter, "7K3PQ", pin, GOOD.replace("2026-10-14T16:50:00Z", "2026-10-11T16:00:00Z")).errorCode())
                .isEqualTo("seen_at_before_case");
        assertThat(correct(reporter, "7K3PQ", pin, GOOD.replace("\"lat\":6.25,\"lng\":-75.59", "\"lat\":4.711,\"lng\":-74.07")).errorCode())
                .isEqualTo("sighting_too_far");
        assertUncorrected();
    }

    @Test
    void theDistanceIsMeasuredFromTheSnappedPublicCenterNeverTheExactPoint() {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD);
        assertThat(r.statements()).anyMatch(q -> q.contains("\"lost_case\".\"last_seen_public_point\""));
        assertThat(r.statements()).noneMatch(q -> q.contains("\"lost_case\".\"last_seen_lat\""));
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "{\"point\":null,\"seen_at\":\"2026-10-14T16:50:00Z\",\"note\":null}               | point",
            "{\"point\":{\"lat\":91,\"lng\":0},\"seen_at\":\"2026-10-14T16:50:00Z\",\"note\":null} | point.lat",
            "{\"point\":{\"lat\":6.25,\"lng\":-75.59},\"seen_at\":null,\"note\":null}           | seen_at",
    })
    void aBrokenFieldIsValidationFailedNamingIt(String json, String field) {
        ApiResponse r = correct(reporter, "7K3PQ", pin, json);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has(field)).as(r.body()).isTrue();
        assertUncorrected();
    }

    @Test
    void aNoteLongerThan500CharactersIsRefused() {
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD.replace("En la esquina", "a".repeat(501)));
        assertThat(r.json().at("/error/fields").has("note")).isTrue();
        assertUncorrected();
    }

    @Test
    void anAbsentRequiredFieldIsAJacksonErrorEvenOnAnUnknownPin() {
        ApiResponse r = correct(clients.newBrowser(), "ZZZZZ", UUID.randomUUID(), "{\"point\":{\"lat\":6.25,\"lng\":-75.59},\"seen_at\":\"2026-10-14T16:50:00Z\"}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("note")).isTrue();
    }

    @Test
    void theHappyPathIsTwoStatementsAnonymousAndThreeSignedIn() {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(2);   // anonymous: pre-read, update (no session lookup)
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        assertThat(correct(helper, "7K3PQ", theirs, GOOD).statements()).hasSize(3);   // session, pre-read, update
    }

    /**
     * The owner hides the pin while its reporter corrects it: the correction passed its pre-read, its UPDATE waits on the
     * owner's uncommitted change, re-checks status = 'visible' after the commit, matches nothing, re-reads and answers
     * forbidden. The longest path: session, pre-read, update, re-read = the ceiling, 4.
     */
    @Test
    void aHideCommittedDuringTheCorrectionMakesItForbiddenOnTheLongestPath() throws Exception {
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        contention.hold("UPDATE scuby.sighting SET status = 'hidden_by_owner' WHERE id = ?", theirs);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        var pool = Executors.newSingleThreadExecutor();
        try {
            Future<ApiResponse> f = pool.submit(() -> correct(helper, "7K3PQ", theirs, GOOD));
            contention.awaitWaiters(1);
            contention.commit();
            ApiResponse r = f.get(30, TimeUnit.SECONDS);
            assertThat(r.status()).isEqualTo(403);
            assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
            assertThat(db.select(SIGHTING.LAT).from(SIGHTING).where(SIGHTING.ID.eq(theirs)).fetchOne(SIGHTING.LAT))
                    .isEqualTo(CaseFixtures.MEDELLIN.lat());
        } finally {
            pool.shutdownNow();
        }
    }
}
