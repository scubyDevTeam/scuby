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
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static org.assertj.core.api.Assertions.assertThat;

/** The owner's verdict on a claim (spec §4.10): revisable, idempotent, any case status, never closes the case. */
@IntegrationTest
class ClaimAnswerTest {

    static final Instant NOW = MutableClock.START;
    static final String PATH = "/cases/{code}/claims/{claimId}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired MutableClock clock;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient claimant;
    UUID carolina;
    UUID andres;
    UUID claim;
    UUID other;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        claimant = clients.newBrowser();
        andres = accounts.signIn(claimant, "andres@correo.co");
        cases.luna(carolina);
        claim = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofHours(2)), "open");
        other = cases.claim("7K3PQ", accounts.person("laura@correo.co"), "+573001112244", NOW.minus(Duration.ofHours(1)), "open");
    }

    private ApiResponse answer(ApiClient as, String code, Object id, String status) {
        return as.post(PATH, "{\"status\":" + (status == null ? "null" : "\"" + status + "\"") + "}", code, id);
    }

    private Record row(UUID id) {
        return db.selectFrom(RECOVERY_CLAIM).where(RECOVERY_CLAIM.ID.eq(id)).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    @Test
    void confirmingStoresTheAnswerAndNeverClosesTheCaseOrTouchesOtherClaims() {
        ApiResponse r = answer(owner, "7K3PQ", claim, "confirmed");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(claim.toString());
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("confirmed");
        assertThat(row(claim).get(RECOVERY_CLAIM.ANSWERED_AT).toInstant()).isEqualTo(NOW);
        assertThat(row(other).get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
        assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).fetchOne(LOST_CASE.STATUS)).isEqualTo("active");
        ApiResponse page = owner.get("/cases/{code}", "7K3PQ");
        assertThat(page.str("/claims/1/status")).isEqualTo("confirmed");      // newest first: the other claim is /claims/0
        assertThat(page.json().get("open_claim_count").asInt()).isEqualTo(1);
    }

    @Test
    void answersAreRevisableAndEachChangeIsTimed() {
        answer(owner, "7K3PQ", claim, "confirmed");
        clock.advance(Duration.ofHours(1));
        assertThat(answer(owner, "7K3PQ", claim, "dismissed").status()).isEqualTo(200);
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("dismissed");
        assertThat(row(claim).get(RECOVERY_CLAIM.ANSWERED_AT).toInstant()).isEqualTo(NOW.plus(Duration.ofHours(1)));
        clock.advance(Duration.ofHours(1));
        assertThat(answer(owner, "7K3PQ", claim, "confirmed").status()).isEqualTo(200);
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("confirmed");
    }

    @Test
    void repeatingTheCurrentAnswerIsANoOpWithoutAWrite() {
        answer(owner, "7K3PQ", claim, "dismissed");
        clock.advance(Duration.ofHours(3));
        ApiResponse again = cold(() -> answer(owner, "7K3PQ", claim, "dismissed"));
        assertThat(again.status()).isEqualTo(200);
        assertThat(again.str("/id")).isEqualTo(claim.toString());
        assertThat(again.statements()).as("%s", again.statements()).hasSize(2);   // session, pre-read
        assertThat(row(claim).get(RECOVERY_CLAIM.ANSWERED_AT).toInstant()).isEqualTo(NOW);
    }

    @Test
    void aStaleClaimCanBeAnsweredAndSeveralClaimsMayBeConfirmed() {
        UUID stale = cases.claim("7K3PQ", accounts.person("pedro@correo.co"), "+573001112255", NOW.minus(Duration.ofDays(9)), "open");
        assertThat(answer(owner, "7K3PQ", stale, "confirmed").status()).isEqualTo(200);
        assertThat(answer(owner, "7K3PQ", claim, "confirmed").status()).isEqualTo(200);
        assertThat(db.fetchCount(RECOVERY_CLAIM, RECOVERY_CLAIM.STATUS.eq("confirmed"))).isEqualTo(2);
    }

    @ParameterizedTest
    @CsvSource({"reunited", "expired", "cancelled"})
    void allowedInEveryCaseStatus(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        assertThat(answer(owner, "7K3PQ", claim, "dismissed").status()).isEqualTo(200);
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("dismissed");
    }

    @Test
    void anUnknownMalformedOrForeignClaimIsNotFound() {
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        UUID foreign = cases.claim("OTH22", andres, "+573001112233", NOW.minusSeconds(60), "open");
        assertThat(answer(owner, "7K3PQ", foreign, "confirmed").errorCode()).isEqualTo("not_found");
        assertThat(answer(owner, "7K3PQ", UUID.randomUUID(), "confirmed").errorCode()).isEqualTo("not_found");
        assertThat(answer(owner, "7K3PQ", "x", "confirmed").errorCode()).isEqualTo("not_found");
        assertThat(row(foreign).get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
    }

    @Test
    void anUnknownOrPurgedCaseIsNotFound() {
        cases.purge("GONE5");
        assertThat(answer(owner, "ZZZZZ", claim, "confirmed").errorCode()).isEqualTo("not_found");
        assertThat(answer(owner, "GONE5", claim, "confirmed").errorCode()).isEqualTo("not_found");
    }

    @Test
    void theClaimantAndStrangersAreForbiddenNobodyIsUnauthorized() {
        assertThat(answer(claimant, "7K3PQ", claim, "confirmed").errorCode()).isEqualTo("forbidden");
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        assertThat(answer(stranger, "7K3PQ", claim, "confirmed").errorCode()).isEqualTo("forbidden");
        assertThat(answer(clients.newBrowser(), "7K3PQ", claim, "confirmed").status()).isEqualTo(401);
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
    }

    @ParameterizedTest(name = "status «{0}»")
    @CsvSource(nullValues = "null", value = {"open", "stale", "null", "CONFIRMED"})
    void onlyConfirmedOrDismissedIsAnAnswer(String status) {
        ApiResponse r = answer(owner, "7K3PQ", claim, status);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("status")).isTrue();
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
    }

    // --- error order: session → case not_found → forbidden → claim not_found → body ---

    @Test
    void theErrorOrder() {
        assertThat(clients.newBrowser().post(PATH, "{", "ZZZZZ", claim).errorCode()).isEqualTo("unauthorized");
        assertThat(claimant.post(PATH, "{}", "ZZZZZ", claim).errorCode()).as("Jackson first").isEqualTo("validation_failed");
        assertThat(answer(claimant, "ZZZZZ", claim, "open").errorCode()).isEqualTo("not_found");
        assertThat(answer(claimant, "7K3PQ", UUID.randomUUID(), "open").errorCode()).isEqualTo("forbidden");
        assertThat(answer(owner, "7K3PQ", UUID.randomUUID(), "open").errorCode()).isEqualTo("not_found");
    }

    @Test
    void theWorstPathIsThreeStatements() {
        ApiResponse r = cold(() -> answer(owner, "7K3PQ", claim, "confirmed"));
        assertThat(r.statements()).as("%s", r.statements()).hasSize(3);   // session, pre-read (case + claim), update
    }
}
