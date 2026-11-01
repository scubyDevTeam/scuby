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
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** «Borrar mi avistamiento» (spec §4.8): a status, never a hard delete; the replay key stays taken. */
@IntegrationTest
class SightingDeleteTest {

    static final Instant NOW = MutableClock.START;
    static final Instant CREATED = NOW.minus(Duration.ofMinutes(5));
    static final String PATH = "/cases/{code}/sightings/{sightingId}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired MutableClock clock;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient reporter;
    String device;
    UUID pin;
    Contention contention;

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
        owner = clients.newBrowser();
        cases.luna(accounts.signIn(owner, "carolina@correo.co"));
        reporter = clients.newBrowser();
        reporter.get("/config");
        device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, null, device, "+573001112233", "visible");
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
    }

    private String status(UUID id) {
        return db.select(SIGHTING.STATUS).from(SIGHTING).where(SIGHTING.ID.eq(id)).fetchOne(SIGHTING.STATUS);
    }

    @Test
    void theReporterDeletesTheirPinAndItReachesNobodyButTheRowStays() {
        ApiResponse r = reporter.delete(PATH, "7K3PQ", pin);
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.body()).isEmpty();
        assertThat(status(pin)).isEqualTo("deleted_by_reporter");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        for (ApiClient viewer : new ApiClient[] {owner, reporter, clients.newBrowser()}) {
            ApiResponse page = viewer.get("/cases/{code}", "7K3PQ");
            assertThat(page.json().get("sightings")).isEmpty();
            assertThat(page.body()).doesNotContain(pin.toString());
        }
        assertThat(clients.newBrowser().get("/feed").json().at("/items/0/sightings_count").asInt()).isZero();
    }

    @Test
    void aReplayOfTheDeletedPinsClientIdAnswersTheDeletedRowsId() {
        String body = "{\"point\":{\"lat\":6.2455,\"lng\":-75.5905},\"seen_at\":\"" + NOW + "\",\"note\":null,\"contact_phone\":null,\"client_id\":\"replay-after-delete\"}";
        String id = reporter.post("/cases/{code}/sightings", body, "7K3PQ").str("/id");
        assertThat(reporter.delete(PATH, "7K3PQ", id).status()).isEqualTo(204);
        ApiResponse again = reporter.post("/cases/{code}/sightings", body, "7K3PQ");
        assertThat(again.status()).isEqualTo(201);
        assertThat(again.str("/id")).isEqualTo(id);
        assertThat(status(UUID.fromString(id))).isEqualTo("deleted_by_reporter");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(2);       // the fixture pin and the deleted one; no new row
    }

    @Test
    void aClosedCaseStillLetsTheReporterDeleteInsideTheWindow() {
        cases.close("7K3PQ", "reunited", NOW.minusSeconds(60));
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).isEqualTo(204);
        assertThat(status(pin)).isEqualTo("deleted_by_reporter");
    }

    @Test
    void theWindowEndsExclusivelyAtFifteenMinutes() {
        clock.set(CREATED.plus(Duration.ofMinutes(15)));
        assertThat(reporter.delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("forbidden");
        assertThat(status(pin)).isEqualTo("visible");
        clock.set(CREATED.plus(Duration.ofMinutes(15)).minusMillis(1));
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).isEqualTo(204);
    }

    @Test
    void someoneElseTheOwnerIncludedIsForbidden() {
        assertThat(clients.newBrowser().delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("forbidden");
        assertThat(owner.delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("forbidden");
        assertThat(status(pin)).isEqualTo("visible");
    }

    @Test
    void anAnonymousPinStaysTheReportersToDeleteAfterTheySignIn() {
        accounts.signIn(reporter, "andres@correo.co");
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).isEqualTo(204);
        assertThat(status(pin)).isEqualTo("deleted_by_reporter");
    }

    @Test
    void anotherPersonsPinSentFromThisBrowserIsForbidden() {
        UUID lauras = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, accounts.person("laura@correo.co"), device, null, "visible");
        accounts.signIn(reporter, "andres@correo.co");
        assertThat(reporter.delete(PATH, "7K3PQ", lauras).errorCode()).isEqualTo("forbidden");
        assertThat(status(lauras)).isEqualTo("visible");
    }

    @Test
    void aHiddenPinIsForbidden() {
        db.update(SIGHTING).set(SIGHTING.STATUS, "hidden_by_owner").where(SIGHTING.ID.eq(pin)).execute();
        assertThat(reporter.delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("forbidden");
        assertThat(status(pin)).isEqualTo("hidden_by_owner");
    }

    @Test
    void deletingTwiceAnswers204BothTimesEvenAfterTheWindowAndWritesNothingMore() {
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).isEqualTo(204);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse again = reporter.delete(PATH, "7K3PQ", pin);                      // a retry after a lost response
        assertThat(again.status()).isEqualTo(204);
        assertThat(again.statements()).as("answered by the pre-read: %s", again.statements()).hasSize(1);   // anonymous: the pre-read
        clock.set(CREATED.plus(Duration.ofHours(2)));
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).as("already done: the window no longer matters").isEqualTo(204);
        assertThat(status(pin)).isEqualTo("deleted_by_reporter");
        assertThat(clients.newBrowser().delete(PATH, "7K3PQ", pin).errorCode()).as("someone else's deleted pin").isEqualTo("not_found");
        assertThat(owner.delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("not_found");
    }

    /** A double tap: the first delete is held uncommitted; the second waits, matches nothing, re-reads, finds it done: 204. */
    @Test
    void aDeleteThatMeetsTheFirstOneInFlightAnswers204() throws Exception {
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        contention.hold("UPDATE scuby.sighting SET status = 'deleted_by_reporter' WHERE id = ?", theirs);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        var pool = Executors.newSingleThreadExecutor();
        try {
            Future<ApiResponse> f = pool.submit(() -> helper.delete(PATH, "7K3PQ", theirs));
            contention.awaitWaiters(1);
            contention.commit();
            ApiResponse r = f.get(30, TimeUnit.SECONDS);
            assertThat(r.status()).isEqualTo(204);
            assertThat(r.statements()).as("%s", r.statements()).hasSize(4);   // session, pre-read, update (zero rows), re-read
            assertThat(status(theirs)).isEqualTo("deleted_by_reporter");
        } finally {
            pool.shutdownNow();
        }
    }

    @ParameterizedTest
    @CsvSource({"ZZZZZ", "bad!"})
    void anUnknownCodeIsNotFound(String code) {
        assertThat(reporter.delete(PATH, code, pin).errorCode()).isEqualTo("not_found");
        assertThat(reporter.delete(PATH, "7K3PQ", "not-a-uuid").errorCode()).isEqualTo("not_found");
    }

    @Test
    void theLongestPathIsFourStatementsWhenTheOwnerHidesThePinMeanwhile() throws Exception {
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        assertThat(helper.delete(PATH, "7K3PQ", theirs).statements()).as("happy path").hasSize(3);   // session, pre-read, update
        UUID another = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        contention.hold("UPDATE scuby.sighting SET status = 'hidden_by_owner' WHERE id = ?", another);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        var pool = Executors.newSingleThreadExecutor();
        try {
            Future<ApiResponse> f = pool.submit(() -> helper.delete(PATH, "7K3PQ", another));
            contention.awaitWaiters(1);
            contention.commit();
            ApiResponse r = f.get(30, TimeUnit.SECONDS);
            assertThat(r.errorCode()).isEqualTo("forbidden");
            assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
            assertThat(status(another)).isEqualTo("hidden_by_owner");
        } finally {
            pool.shutdownNow();
        }
    }
}
