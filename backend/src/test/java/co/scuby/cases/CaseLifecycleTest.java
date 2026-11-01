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
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** Reunite, cancel, reopen (docs/product/04 · Case state machine; spec §4.3–4.5). */
@IntegrationTest
class CaseLifecycleTest {

    static final Instant NOW = MutableClock.START;

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient stranger;
    UUID carolina;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        cases.luna(carolina);
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, "3".repeat(64), null, "visible");
    }

    private Record luna() {
        return db.selectFrom(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne();
    }

    private ApiResponse reunite(ApiClient as, String code, String attribution) {
        return as.post("/cases/{code}/reunite", "{\"resolution_attribution\":" + json(attribution) + "}", code);
    }

    private ApiResponse cancel(ApiClient as, String code, String resolution) {
        return as.post("/cases/{code}/cancel", "{\"resolution\":" + json(resolution) + "}", code);
    }

    private ApiResponse reopen(ApiClient as, String code) {
        return as.post("/cases/{code}/reopen", null, code);
    }

    private static String json(String s) {
        return s == null ? "null" : "\"" + s + "\"";
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    private void assertUnchanged() {
        Record r = luna();
        assertThat(r.get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(r.get(LOST_CASE.RESOLUTION)).isNull();
        assertThat(r.get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
        assertThat(r.get(LOST_CASE.RESOLVED_AT)).isNull();
    }

    // --- reunite ---

    @Test
    void reuniteClosesTheCaseWithItsResolutionAndAttributionAndAnswersTheCode() {
        ApiResponse r = reunite(owner, "7k3pq", "platform_sighting");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        Record row = luna();
        assertThat(row.get(LOST_CASE.STATUS)).isEqualTo("reunited");
        assertThat(row.get(LOST_CASE.RESOLUTION)).isEqualTo("reunited_home");
        assertThat(row.get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isEqualTo("platform_sighting");
        assertThat(row.get(LOST_CASE.RESOLVED_AT).toInstant()).isEqualTo(NOW);
        ApiResponse page = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(page.str("/status")).isEqualTo("reunited");
        assertThat(page.str("/resolved_at")).isEqualTo("2026-10-14T17:00:00Z");
        assertThat(page.isNull("/contact")).isTrue();
    }

    @ParameterizedTest
    @CsvSource({"platform_sighting", "platform_claim", "platform_share", "offline", "unknown"})
    void everyAttributionIsAcceptedAndStoredAsSent(String attribution) {
        assertThat(reunite(owner, "7K3PQ", attribution).status()).isEqualTo(200);
        assertThat(luna().get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isEqualTo(attribution);
    }

    @Test
    void reuniteLeavesThePetItsLinkAndTheSightingsUntouched() {
        UUID pet = cases.petOf("7K3PQ");
        reunite(owner, "7K3PQ", "offline");
        assertThat(db.fetchCount(RESPONSIBILITY_LINK, RESPONSIBILITY_LINK.PET_ID.eq(pet).and(RESPONSIBILITY_LINK.ACTIVE_TO.isNull()))).isEqualTo(1);
        assertThat(db.fetchCount(SIGHTING, SIGHTING.CASE_CODE.eq("7K3PQ").and(SIGHTING.STATUS.eq("visible")))).isEqualTo(1);
    }

    // --- cancel ---

    @ParameterizedTest
    @CsvSource({"false_alarm", "duplicate"})
    void cancelStoresTheReasonAndNoAttribution(String resolution) {
        ApiResponse r = cancel(owner, "7K3PQ", resolution);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        Record row = luna();
        assertThat(row.get(LOST_CASE.STATUS)).isEqualTo("cancelled");
        assertThat(row.get(LOST_CASE.RESOLUTION)).isEqualTo(resolution);
        assertThat(row.get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
        assertThat(row.get(LOST_CASE.RESOLVED_AT).toInstant()).isEqualTo(NOW);
    }

    @Test
    void aCancelledCaseIsStillServedWithoutContactListedInMisCasosAndGoneFromTheFeed() {
        cancel(owner, "7K3PQ", "false_alarm");
        ApiResponse page = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(page.status()).isEqualTo(200);
        assertThat(page.str("/status")).isEqualTo("cancelled");
        assertThat(page.isNull("/contact")).isTrue();
        assertThat(clients.newBrowser().get("/feed").json().get("items")).isEmpty();
        assertThat(owner.get("/me/cases").str("/0/status")).isEqualTo("cancelled");
    }

    // --- a case closes once; a repeat of the same close is a success that writes nothing ---

    @Test
    void aRepeatedReuniteAnswersOkAndKeepsTheFirstCallsAttribution() {
        reunite(owner, "7K3PQ", "offline");
        ApiResponse again = cold(() -> reunite(owner, "7K3PQ", "unknown"));       // a retry after a lost response, another attribution
        assertThat(again.status()).isEqualTo(200);
        assertThat(again.str("/id")).isEqualTo("7K3PQ");
        assertThat(again.statements()).as("answered by the pre-read: %s", again.statements()).hasSize(2);
        assertThat(luna().get(LOST_CASE.RESOLUTION)).isEqualTo("reunited_home");
        assertThat(luna().get(LOST_CASE.RESOLUTION_ATTRIBUTION)).as("the first call's attribution stays").isEqualTo("offline");
        ApiResponse cancelAfter = cancel(owner, "7K3PQ", "duplicate");
        assertThat(cancelAfter.status()).isEqualTo(409);
        assertThat(cancelAfter.errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("reunited");
    }

    @Test
    void aRepeatedCancelAnswersOkAndKeepsTheFirstCallsReason() {
        cancel(owner, "7K3PQ", "duplicate");
        ApiResponse again = cancel(owner, "7K3PQ", "false_alarm");
        assertThat(again.status()).isEqualTo(200);
        assertThat(again.str("/id")).isEqualTo("7K3PQ");
        assertThat(luna().get(LOST_CASE.RESOLUTION)).isEqualTo("duplicate");
        ApiResponse reuniteAfter = reunite(owner, "7K3PQ", "offline");
        assertThat(reuniteAfter.status()).isEqualTo(409);
        assertThat(reuniteAfter.errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
    }

    @ParameterizedTest(name = "{0} on {1} → {2}")
    @CsvSource({
            "reunite, expired,   409",
            "reunite, reunited,  200",
            "reunite, cancelled, 409",
            "cancel,  expired,   409",
            "cancel,  reunited,  409",
            "cancel,  cancelled, 200",
    })
    void onAClosedCaseOnlyTheSameCloseIsOkAndNothingIsWritten(String action, String status, int expected) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));                // resolution left NULL: a write would show
        ApiResponse r = "reunite".equals(action) ? reunite(owner, "7K3PQ", "offline") : cancel(owner, "7K3PQ", "duplicate");
        assertThat(r.status()).isEqualTo(expected);
        if (expected == 409) assertThat(r.errorCode()).isEqualTo("invalid_transition");
        else assertThat(r.str("/id")).isEqualTo("7K3PQ");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo(status);
        assertThat(luna().get(LOST_CASE.RESOLUTION)).as("nothing written").isNull();
        assertThat(luna().get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
        assertThat(luna().get(LOST_CASE.RESOLVED_AT).toInstant()).isEqualTo(NOW.minus(Duration.ofDays(1)));
    }

    // --- reopen ---

    @Test
    void reopenBringsBackAnExpiredCaseAndKeepsItsSightingsAndPublishedAt() {
        Instant published = luna().get(LOST_CASE.PUBLISHED_AT).toInstant();
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        ApiResponse r = reopen(owner, "7K3PQ");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        Record row = luna();
        assertThat(row.get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(row.get(LOST_CASE.RESOLVED_AT)).isNull();
        assertThat(row.get(LOST_CASE.RESOLUTION)).isNull();
        assertThat(row.get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
        assertThat(row.get(LOST_CASE.PUBLISHED_AT).toInstant()).isEqualTo(published);
        assertThat(db.fetchCount(SIGHTING, SIGHTING.CASE_CODE.eq("7K3PQ"))).isEqualTo(1);
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().get("sightings")).hasSize(1);
    }

    @Test
    void theReopenWindowIsThirtyDaysInclusive() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(30)));
        assertThat(reopen(owner, "7K3PQ").status()).isEqualTo(200);
    }

    @Test
    void oneMillisecondPastThirtyDaysIsInvalidTransition() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(30)).minusMillis(1));
        ApiResponse r = reopen(owner, "7K3PQ");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    /** The smallest step Postgres timestamptz keeps is 1 µs: the window's edge is pinned on both sides, in the pre-read and in the UPDATE's guard. */
    @Test
    void oneMicrosecondInsideThirtyDaysIsReopenedAndOneMicrosecondPastIsRefused() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(30)).plus(1, java.time.temporal.ChronoUnit.MICROS));
        assertThat(reopen(owner, "7K3PQ").status()).isEqualTo(200);
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("active");
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(30)).minus(1, java.time.temporal.ChronoUnit.MICROS));
        ApiResponse r = reopen(owner, "7K3PQ");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    @ParameterizedTest
    @CsvSource({"reunited", "cancelled"})
    void aReunitedOrCancelledCaseIsNeverReopened(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        assertThat(reopen(owner, "7K3PQ").errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo(status);
    }

    @Test
    void reopenOnAnAlreadyActiveCaseAnswersOkAndWritesNothing() {
        Instant published = luna().get(LOST_CASE.PUBLISHED_AT).toInstant();
        ApiResponse r = cold(() -> reopen(owner, "7K3PQ"));                        // a retry, or a claim reactivated it first
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        assertThat(r.statements()).as("answered by the pre-read: %s", r.statements()).hasSize(2);
        assertUnchanged();
        assertThat(luna().get(LOST_CASE.PUBLISHED_AT).toInstant()).isEqualTo(published);
    }

    @Test
    void reopenNamesThePetsOtherActiveCase() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", NOW.minus(Duration.ofDays(1)));
        ApiResponse r = reopen(owner, "7K3PQ");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("NEW22");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    // --- who and which code ---

    @Test
    void anUnknownMalformedOrPurgedCodeIsNotFoundForEveryAction() {
        cases.purge("GONE5");
        for (String code : new String[] {"ZZZZZ", "bad!", "GONE5"}) {
            assertThat(reunite(owner, code, "offline").errorCode()).as(code).isEqualTo("not_found");
            assertThat(cancel(owner, code, "duplicate").errorCode()).as(code).isEqualTo("not_found");
            assertThat(reopen(owner, code).errorCode()).as(code).isEqualTo("not_found");
        }
    }

    @Test
    void someoneElseIsForbiddenAndNothingChanges() {
        assertThat(reunite(stranger, "7K3PQ", "offline").status()).isEqualTo(403);
        assertThat(cancel(stranger, "7K3PQ", "duplicate").errorCode()).isEqualTo("forbidden");
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(1)));
        assertThat(reopen(stranger, "7K3PQ").errorCode()).isEqualTo("forbidden");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    @Test
    void withoutASessionItIsUnauthorized() {
        ApiResponse r = clients.newBrowser().post("/cases/{code}/reunite", "{\"resolution_attribution\":\"offline\"}", "7K3PQ");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
        assertUnchanged();
    }

    @ParameterizedTest(name = "reunite «{0}»")
    @CsvSource(nullValues = "null", value = {"luck", "null", "''", "REUNITED_HOME"})
    void aWrongAttributionIsValidationFailedNamingTheField(String attribution) {
        ApiResponse r = reunite(owner, "7K3PQ", attribution);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("resolution_attribution")).isTrue();
        assertUnchanged();
    }

    @ParameterizedTest(name = "cancel «{0}»")
    @CsvSource(nullValues = "null", value = {"reunited_home", "no_response", "gave_up", "null"})
    void aWrongCancelReasonIsValidationFailedNamingTheField(String resolution) {
        ApiResponse r = cancel(owner, "7K3PQ", resolution);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("resolution")).isTrue();
        assertUnchanged();
    }

    @Test
    void anAbsentRequiredFieldIsAJacksonErrorNamingIt() {
        ApiResponse r = owner.post("/cases/{code}/reunite", "{}", "7K3PQ");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("resolution_attribution")).isTrue();
        assertThat(owner.post("/cases/{code}/cancel", "{}", "7K3PQ").json().at("/error/fields").has("resolution")).isTrue();
        assertUnchanged();
    }

    // --- statements (session-cache miss) ---

    @Test
    void measuredStatements() {
        assertThat(cold(() -> reunite(owner, "7K3PQ", "offline")).statements()).hasSize(3);   // session, pre-read, conditional update
        db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").set(LOST_CASE.RESOLUTION, (String) null)
          .set(LOST_CASE.RESOLUTION_ATTRIBUTION, (String) null).set(LOST_CASE.RESOLVED_AT, NOW.minusSeconds(60).atOffset(ZoneOffset.UTC)).execute();
        assertThat(cold(() -> reopen(owner, "7K3PQ")).statements()).hasSize(3);                // session, pre-read, conditional update
        assertThat(cold(() -> cancel(owner, "7K3PQ", "duplicate")).statements()).hasSize(3);
        assertThat(cold(() -> cancel(owner, "7K3PQ", "duplicate")).statements()).as("a repeat, answered by the pre-read").hasSize(2);
        assertThat(cold(() -> reopen(owner, "7K3PQ")).statements()).as("refused by the pre-read").hasSize(2);
    }
}
