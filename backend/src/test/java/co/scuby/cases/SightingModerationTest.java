package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
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

/** The owner moderates pins (docs/product/04 · sighting; spec §4.6). Includes its error order and the leak checks. */
@IntegrationTest
class SightingModerationTest {

    static final Instant NOW = MutableClock.START;
    static final String PATH = "/cases/{code}/sightings/{sightingId}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient stranger;
    UUID carolina;
    UUID pin;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        cases.luna(carolina);
        pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, "3".repeat(64),
                "+573001112233", "visible");
    }

    private ApiResponse moderate(ApiClient as, String code, Object id, String json) {
        return as.patch(PATH, json, code, id);
    }

    private Record row(UUID id) {
        return db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(id)).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    @Test
    void hidingTakesThePinOffThePublicViewsAndTheOwnerStillSeesItWithItsContact() {
        ApiResponse r = moderate(owner, "7K3PQ", pin, "{\"hidden\":true}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(pin.toString());
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("hidden_by_owner");
        ApiResponse pub = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(pub.json().get("sightings")).isEmpty();
        assertThat(pub.body()).doesNotContain("3001112233");
        assertThat(clients.newBrowser().get("/feed").json().at("/items/0/sightings_count").asInt()).isZero();
        ApiResponse own = owner.get("/cases/{code}", "7K3PQ");
        assertThat(own.json().get("sightings")).hasSize(1);
        assertThat(own.json().at("/sightings/0/hidden").asBoolean()).isTrue();
        assertThat(own.str("/sightings/0/contact_phone")).isEqualTo("+573001112233");
    }

    @Test
    void unhidingBringsThePinBack() {
        moderate(owner, "7K3PQ", pin, "{\"hidden\":true}");
        assertThat(moderate(owner, "7K3PQ", pin, "{\"hidden\":false}").status()).isEqualTo(200);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().get("sightings")).hasSize(1);
    }

    @Test
    void highlightAndHideAreIndependent() {
        moderate(owner, "7K3PQ", pin, "{\"hidden\":true}");
        assertThat(moderate(owner, "7K3PQ", pin, "{\"highlighted\":true}").status()).isEqualTo(200);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("hidden_by_owner");
        assertThat(row(pin).get(SIGHTING.HIGHLIGHTED_BY_OWNER)).isTrue();
        moderate(owner, "7K3PQ", pin, "{\"highlighted\":false,\"hidden\":false}");
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
        assertThat(row(pin).get(SIGHTING.HIGHLIGHTED_BY_OWNER)).isFalse();
    }

    @Test
    void aHighlightShowsToEveryone() {
        moderate(owner, "7K3PQ", pin, "{\"highlighted\":true}");
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().at("/sightings/0/highlighted_by_owner").asBoolean()).isTrue();
    }

    @Test
    void repeatingAValueIsIdempotent() {
        assertThat(moderate(owner, "7K3PQ", pin, "{\"hidden\":true,\"highlighted\":true}").status()).isEqualTo(200);
        assertThat(moderate(owner, "7K3PQ", pin, "{\"hidden\":true,\"highlighted\":true}").status()).isEqualTo(200);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("hidden_by_owner");
        assertThat(row(pin).get(SIGHTING.HIGHLIGHTED_BY_OWNER)).isTrue();
    }

    @Test
    void anEmptyBodyIsANoOpWithoutAWrite() {
        ApiResponse r = cold(() -> moderate(owner, "7K3PQ", pin, "{}"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(pin.toString());
        assertThat(r.statements()).as("%s", r.statements()).hasSize(2);   // session, pre-read
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
    }

    @ParameterizedTest
    @CsvSource({"reunited", "expired", "cancelled"})
    void allowedOnAClosedCase(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        assertThat(moderate(owner, "7K3PQ", pin, "{\"hidden\":true}").status()).isEqualTo(200);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("hidden_by_owner");
    }

    @ParameterizedTest
    @CsvSource({"removed_by_moderation", "deleted_by_reporter"})
    void aModeratedOrDeletedPinIsNotFoundEvenToTheOwnerAndStaysAsItIs(String status) {
        UUID gone = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(60), NOW.minusSeconds(60), null, "4".repeat(64),
                "+573004445566", status);
        ApiResponse r = moderate(owner, "7K3PQ", gone, "{\"hidden\":false}");
        assertThat(r.status()).isEqualTo(404);
        assertThat(r.errorCode()).isEqualTo("not_found");
        assertThat(row(gone).get(SIGHTING.STATUS)).isEqualTo(status);
        ApiResponse own = owner.get("/cases/{code}", "7K3PQ");
        assertThat(own.json().get("sightings")).as("the owner's view lists only visible and hidden pins").hasSize(1);
        assertThat(own.body()).doesNotContain(gone.toString()).doesNotContain("3004445566");
    }

    @Test
    void aPinOfAnotherCaseAnUnknownIdOrAMalformedIdIsNotFound() {
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        UUID other = cases.sighting("OTH22", CaseFixtures.MEDELLIN, NOW.minusSeconds(60), NOW.minusSeconds(60), null, "5".repeat(64), null, "visible");
        assertThat(moderate(owner, "7K3PQ", other, "{\"hidden\":true}").errorCode()).isEqualTo("not_found");
        assertThat(moderate(owner, "7K3PQ", UUID.randomUUID(), "{\"hidden\":true}").errorCode()).isEqualTo("not_found");
        assertThat(moderate(owner, "7K3PQ", "not-a-uuid", "{\"hidden\":true}").errorCode()).isEqualTo("not_found");
        assertThat(row(other).get(SIGHTING.STATUS)).isEqualTo("visible");
    }

    @Test
    void anExplicitNullIsValidationFailedNamingTheField() {
        ApiResponse r = moderate(owner, "7K3PQ", pin, "{\"hidden\":null}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("hidden")).isTrue();
        assertThat(moderate(owner, "7K3PQ", pin, "{\"highlighted\":null}").json().at("/error/fields").has("highlighted")).isTrue();
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
    }

    @Test
    void someoneElseIsForbiddenAndNobodyIsUnauthorized() {
        assertThat(moderate(stranger, "7K3PQ", pin, "{\"hidden\":true}").errorCode()).isEqualTo("forbidden");
        assertThat(moderate(clients.newBrowser(), "7K3PQ", pin, "{\"hidden\":true}").status()).isEqualTo(401);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
    }

    // --- error order: session → case not_found → forbidden → pin not_found → body (spec §4.6) ---

    @Test
    void anUnknownCaseBeatsForbiddenAndForbiddenBeatsAnUnknownPin() {
        assertThat(moderate(stranger, "ZZZZZ", pin, "{\"hidden\":null}").errorCode()).isEqualTo("not_found");
        assertThat(moderate(stranger, "7K3PQ", UUID.randomUUID(), "{\"hidden\":null}").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void anUnknownPinBeatsABadBody() {
        assertThat(moderate(owner, "7K3PQ", UUID.randomUUID(), "{\"hidden\":null}").errorCode()).isEqualTo("not_found");
    }

    @Test
    void anUnreadableBodyIsAnsweredBeforeAnyLookup() {
        assertThat(moderate(stranger, "ZZZZZ", pin, "{\"hidden\":\"yes please\"}").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void theWorstPathIsThreeStatements() {
        ApiResponse r = cold(() -> moderate(owner, "7K3PQ", pin, "{\"hidden\":true,\"highlighted\":true}"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(3);   // session, pre-read (case + pin), update
    }

    /**
     * The pin is removed by moderation while the owner hides it: the hide passed its pre-read (visible), its UPDATE waits on
     * the uncommitted change, re-checks status IN ('visible','hidden_by_owner') after the commit and matches nothing:
     * not_found, the removal stands, still 3 statements.
     */
    @Test
    void aPinModeratedAwayDuringTheHideIsNotFoundAndStaysRemoved() throws Exception {
        try (Contention contention = new Contention(dataSource, db)) {
            contention.hold("UPDATE scuby.sighting SET status = 'removed_by_moderation' WHERE id = ?", pin);
            caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
            var pool = Executors.newSingleThreadExecutor();
            try {
                Future<ApiResponse> f = pool.submit(() -> moderate(owner, "7K3PQ", pin, "{\"hidden\":true}"));
                contention.awaitWaiters(1);
                contention.commit();
                ApiResponse r = f.get(30, TimeUnit.SECONDS);
                assertThat(r.status()).isEqualTo(404);
                assertThat(r.errorCode()).isEqualTo("not_found");
                assertThat(r.statements()).as("%s", r.statements()).hasSize(3);
                assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("removed_by_moderation");
            } finally {
                pool.shutdownNow();
            }
        }
    }
}
