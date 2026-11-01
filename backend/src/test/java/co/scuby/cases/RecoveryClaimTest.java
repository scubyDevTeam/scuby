package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.Photos;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.OUTBOX_EVENTS;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** «Lo tengo» (docs/product/04 · recovery_claim; spec §4.9). */
@IntegrationTest
class RecoveryClaimTest {

    static final Instant NOW = MutableClock.START;
    static final String PATH = "/cases/{code}/recovery-claims";
    static final String LUNA_URL = "https://wa.me/573114829017?text=Hola%2C%20vi%20tu%20aviso%20de%20Luna%20en%20Scuby%20%287K3PQ%29%20y%20creo%20que%20lo%20tengo.";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired MutableClock clock;
    @Autowired co.scuby.support.TestDb testDb;

    ApiClient owner;
    ApiClient helper;
    UUID carolina;
    UUID andres;
    String helperDevice;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        helper = clients.newBrowser();
        helper.get("/config");   // the device cookie, before the sign-in (an anonymous /config is within its ceiling)
        andres = accounts.signIn(helper, "andres@correo.co");
        helperDevice = Hashing.sha256Hex(helper.cookie("device").orElseThrow());
        cases.luna(carolina);
    }

    private ApiResponse claim(ApiClient as, String code, String json) {
        return as.post(PATH, json, code);
    }

    private ApiResponse claim(String extra) {
        return claim(helper, "7K3PQ", "{\"phone\":\"+573001112233\"" + extra + "}");
    }

    private Record theClaim() {
        return db.selectFrom(RECOVERY_CLAIM).fetchOne();
    }

    private Record luna() {
        return db.selectFrom(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        testDb.cold();
        return call.get();
    }

    @Test
    void aSignedInHelperClaimsAndGetsTheOwnersWhatsappWithThePrefilledText() {
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/whatsapp_url")).isEqualTo(LUNA_URL);
        Record c = theClaim();
        assertThat(r.str("/id")).isEqualTo(c.get(RECOVERY_CLAIM.ID).toString());
        assertThat(c.get(RECOVERY_CLAIM.CASE_CODE)).isEqualTo("7K3PQ");
        assertThat(c.get(RECOVERY_CLAIM.CLAIMANT_PERSON_ID)).isEqualTo(andres);
        assertThat(c.get(RECOVERY_CLAIM.PHONE)).isEqualTo("+573001112233");
        assertThat(c.get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
        assertThat(c.get(RECOVERY_CLAIM.CREATED_AT).toInstant()).isEqualTo(NOW);
        assertThat(c.get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW);
        assertThat(c.get(RECOVERY_CLAIM.ANSWERED_AT)).isNull();
        assertThat(c.get(RECOVERY_CLAIM.LAT)).isNull();
        assertThat(c.get(RECOVERY_CLAIM.PHOTO_URLS)).isEmpty();
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(db.fetchCount(OUTBOX_EVENTS)).as("L1 writes no outbox row").isZero();
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource({"expose_whatsapp = false", "phone_has_whatsapp = false", "contact_phone_verified = false", "in_app_only = true"})
    void withoutThePublicContactRuleThereIsNoWhatsappUrlButTheClaimIsStored(String assignment) {
        db.execute("UPDATE scuby.lost_case SET " + assignment + " WHERE code = '7K3PQ'");
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.isNull("/whatsapp_url")).isTrue();
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
    }

    @Test
    void theOwnerCannotClaimTheirOwnCase() {
        ApiResponse r = claim(owner, "7K3PQ", "{\"phone\":\"+573001112233\"}");
        assertThat(r.status()).isEqualTo(403);
        assertThat(r.errorCode()).isEqualTo("forbidden");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void aRepeatRefreshesTheOpenClaimWithTheNewPhonePhotosAndPin() {
        String first = claim("").str("/id");
        clock.advance(Duration.ofHours(1));
        UUID pin = cases.sighting("7K3PQ", new co.scuby.platform.db.GeoPoint(6.25, -75.59), NOW, NOW, andres, "9".repeat(64), null, "visible");
        String photo = Photos.uploaded(helper, "claim", "repeat-photo");
        ApiResponse again = claim(helper, "7K3PQ", "{\"phone\":\"+573009998877\",\"photo_urls\":[\"" + photo + "\"],\"from_sighting_id\":\"" + pin + "\"}");
        assertThat(again.status()).as("the contract's only success status for claimRecovery").isEqualTo(201);
        assertThat(again.str("/id")).isEqualTo(first);
        assertThat(again.str("/whatsapp_url")).isEqualTo(LUNA_URL);
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
        Record c = theClaim();
        assertThat(c.get(RECOVERY_CLAIM.PHONE)).as("the claimant's current number").isEqualTo("+573009998877");
        assertThat(List.of(c.get(RECOVERY_CLAIM.PHOTO_URLS))).containsExactly(photo);
        assertThat(c.get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
        assertThat(c.get(RECOVERY_CLAIM.LAT)).isEqualTo(6.25);
        assertThat(c.get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW.plus(Duration.ofHours(1)));
        assertThat(c.get(RECOVERY_CLAIM.CREATED_AT).toInstant()).as("the claim keeps its birth").isEqualTo(NOW);
        assertThat(c.get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
    }

    @Test
    void aRepeatThatSendsNoPhotosNoLinkKeepsTheEarlierOnesAndOnlyThePhoneAndFreshnessChange() {
        UUID pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), andres, "9".repeat(64), null, "visible");
        String photo = Photos.uploaded(helper, "claim", "first-photo");
        claim(",\"photo_urls\":[\"" + photo + "\"],\"from_sighting_id\":\"" + pin + "\"");
        clock.advance(Duration.ofHours(2));
        ApiResponse again = claim(helper, "7K3PQ", "{\"phone\":\"+573009998877\",\"photo_urls\":[]}");
        assertThat(again.status()).isEqualTo(201);
        Record c = theClaim();
        assertThat(c.get(RECOVERY_CLAIM.PHONE)).isEqualTo("+573009998877");
        assertThat(List.of(c.get(RECOVERY_CLAIM.PHOTO_URLS))).as("an empty list keeps the stored photos").containsExactly(photo);
        assertThat(c.get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
        assertThat(c.get(RECOVERY_CLAIM.LAT)).isEqualTo(CaseFixtures.MEDELLIN.lat());
        assertThat(c.get(RECOVERY_CLAIM.LNG)).isEqualTo(CaseFixtures.MEDELLIN.lng());
        assertThat(c.get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW.plus(Duration.ofHours(2)));
    }

    @Test
    void aRepeatWhoseLinkIsIneligibleKeepsTheStoredLinkAndPoint() {
        UUID pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), andres, "9".repeat(64), null, "visible");
        claim(",\"from_sighting_id\":\"" + pin + "\"");
        assertThat(claim(",\"from_sighting_id\":\"not-a-uuid\"").status()).isEqualTo(201);
        assertThat(theClaim().get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
        assertThat(theClaim().get(RECOVERY_CLAIM.LAT)).isEqualTo(CaseFixtures.MEDELLIN.lat());
    }

    /** The 24 h prefill edge, exclusive: one millisecond inside the window links, exactly 24 h (the table above) does not. */
    @Test
    void aPinOneMillisecondInsideTheTwentyFourHourWindowIsLinked() {
        Instant at = NOW.minus(Duration.ofHours(24)).plusMillis(1);
        UUID pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, at, at, andres, "9".repeat(64), null, "visible");
        assertThat(claim(",\"from_sighting_id\":\"" + pin + "\"").status()).isEqualTo(201);
        assertThat(theClaim().get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
    }

    @Test
    void aRepeatMakesAStaleClaimFreshAgainUnderTheSameId() {
        UUID stale = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(8)), "open");
        ApiResponse r = claim(helper, "7K3PQ", "{\"phone\":\"+573009998877\"}");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/id")).isEqualTo(stale.toString());
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
        assertThat(theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW);
        assertThat(theClaim().get(RECOVERY_CLAIM.PHONE)).isEqualTo("+573009998877");
        assertThat(ClaimDerivation.isStale("open", theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant(), NOW)).isFalse();
    }

    @Test
    void aRepeatOnAnExpiredCaseInsideTheWindowReactivatesItAndRefreshesTheClaim() {
        UUID stale = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(9)), "open");
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(2)));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/id")).isEqualTo(stale.toString());
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW);
    }

    /**
     * The claimant comes back from the old poster, but the case expired and the family published a new case for the pet:
     * the repeat answers active_case_exists naming the live case (where the family is looking), never the old claim, and
     * hands out no WhatsApp link. The old claim is left exactly as it was.
     */
    @Test
    void aRepeatOnAnExpiredCaseWhosePetHasAnotherActiveCaseIsActiveCaseExistsNeverTheOldClaim() {
        UUID old = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(5)), "open");
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", NOW.minus(Duration.ofDays(1)));
        ApiResponse r = claim(helper, "7K3PQ", "{\"phone\":\"+573009998877\"}");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("NEW22");
        assertThat(r.body()).doesNotContain(old.toString()).doesNotContain("wa.me");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
        assertThat(theClaim().get(RECOVERY_CLAIM.PHONE)).isEqualTo("+573001112233");
        assertThat(theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW.minus(Duration.ofDays(5)));
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    @Test
    void aRepeatOnAReunitedCaseIsInvalidTransitionNeverTheOldClaim() {
        UUID old = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(1)), "open");
        cases.close("7K3PQ", "reunited", NOW.minusSeconds(60));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(r.body()).doesNotContain(old.toString()).doesNotContain("wa.me");
        assertThat(theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW.minus(Duration.ofDays(1)));
    }

    @Test
    void afterTheOwnerAnsweredANewClaimIsANewRow() {
        UUID dismissed = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(1)), "dismissed");
        String id = claim("").str("/id");
        assertThat(id).isNotEqualTo(dismissed.toString());
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(2);
    }

    @Test
    void anotherPersonsClaimIsTheirOwnRow() {
        claim("");
        ApiClient other = clients.newBrowser();
        accounts.signIn(other, "laura@correo.co");
        assertThat(claim(other, "7K3PQ", "{\"phone\":\"+573001112244\"}").status()).isEqualTo(201);
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(2);
    }

    @Test
    void anExpiredCaseInsideTheWindowIsReactivatedAndClaimed() {
        Instant published = luna().get(LOST_CASE.PUBLISHED_AT).toInstant();
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/whatsapp_url")).as("evaluated after the reactivation").isEqualTo(LUNA_URL);
        Record c = luna();
        assertThat(c.get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(c.get(LOST_CASE.RESOLVED_AT)).isNull();
        assertThat(c.get(LOST_CASE.RESOLUTION)).isNull();
        assertThat(c.get(LOST_CASE.PUBLISHED_AT).toInstant()).isEqualTo(published);
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
    }

    @Test
    void theWindowIsThirtyDaysInclusiveAndOneMillisecondMoreIsInvalidTransition() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(30)));
        assertThat(claim("").status()).isEqualTo(201);
        cases.lostCase(carolina, "OLD22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minus(Duration.ofDays(60)));
        cases.close("OLD22", "expired", NOW.minus(Duration.ofDays(30)).minusMillis(1));
        ApiResponse late = claim(helper, "OLD22", "{\"phone\":\"+573001112233\"}");
        assertThat(late.status()).isEqualTo(409);
        assertThat(late.errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(RECOVERY_CLAIM, RECOVERY_CLAIM.CASE_CODE.eq("OLD22"))).isZero();
    }

    @ParameterizedTest
    @CsvSource({"reunited", "cancelled"})
    void aReunitedOrCancelledCaseTakesNoClaim(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void aReactivationThatWouldMakeASecondActiveCaseIsActiveCaseExists() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", NOW.minus(Duration.ofDays(1)));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("NEW22");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void fromTheCallersOwnPinTheClaimCopiesItsPointNeverItsPhotos() {
        UUID pin = cases.sighting("7K3PQ", new co.scuby.platform.db.GeoPoint(6.25, -75.59), NOW.minusSeconds(3600), NOW.minusSeconds(3600),
                andres, "9".repeat(64), null, "visible");
        db.update(SIGHTING).set(SIGHTING.PHOTO_URLS, new String[] {"http://localhost/dev-media/" + "b".repeat(64) + ".jpg"})
          .where(SIGHTING.ID.eq(pin)).execute();
        assertThat(claim(",\"from_sighting_id\":\"" + pin + "\"").status()).isEqualTo(201);
        Record c = theClaim();
        assertThat(c.get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
        assertThat(c.get(RECOVERY_CLAIM.LAT)).isEqualTo(6.25);
        assertThat(c.get(RECOVERY_CLAIM.LNG)).isEqualTo(-75.59);
        assertThat(c.get(RECOVERY_CLAIM.PHOTO_URLS)).isEmpty();
    }

    @Test
    void anAnonymousPinFromTheCallersBrowserStaysTheirsAfterTheySignIn() {
        // The passer-by reported «Lo vi» without an account, caught the dog, and signed in to say «Lo tengo».
        UUID pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), null, helperDevice, null, "visible");
        assertThat(claim(",\"from_sighting_id\":\"" + pin + "\"").status()).isEqualTo(201);
        assertThat(theClaim().get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
        assertThat(theClaim().get(RECOVERY_CLAIM.LAT)).isEqualTo(CaseFixtures.MEDELLIN.lat());
    }

    /** The link is attribution, never a reason to lose a claim: an ineligible pin is dropped and the claim is stored without it. */
    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // label,                                  reporter, sameDevice, status,              ageMinutes, onThisCase
            "'an anonymous pin from another device',   NONE,     false,      visible,             60,         true",
            "'another person''s pin from this device', OTHER,    true,       visible,             60,         true",
            "'hidden by the owner',                    HELPER,   false,      hidden_by_owner,     60,         true",
            "'deleted by its reporter',                HELPER,   false,      deleted_by_reporter, 5,          true",
            "'exactly 24 h old',                       HELPER,   false,      visible,             1440,       true",
            "'on another case',                        HELPER,   false,      visible,             60,         false",
    })
    void aPinThatIsNotTheCallersRecentVisibleOneHereIsIgnoredAndTheClaimIsStored(String label, String reporter, boolean sameDevice,
                                                                                  String status, int ageMinutes, boolean onThisCase) {
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        Instant at = NOW.minus(Duration.ofMinutes(ageMinutes));
        UUID reporterPerson = switch (reporter) {
            case "HELPER" -> andres;
            case "OTHER" -> accounts.person("laura@correo.co");
            default -> null;
        };
        UUID pin = cases.sighting(onThisCase ? "7K3PQ" : "OTH22", CaseFixtures.MEDELLIN, at, at, reporterPerson,
                sameDevice ? helperDevice : "8".repeat(64), null, status);
        ApiResponse r = claim(",\"from_sighting_id\":\"" + pin + "\"");
        assertThat(r.status()).as(label).isEqualTo(201);
        assertThat(r.str("/whatsapp_url")).as(label).isEqualTo(LUNA_URL);
        Record c = theClaim();
        assertThat(c.get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).as(label).isNull();
        assertThat(c.get(RECOVERY_CLAIM.LAT)).as(label).isNull();
        assertThat(c.get(RECOVERY_CLAIM.LNG)).as(label).isNull();
    }

    @ParameterizedTest
    @CsvSource({"not-a-uuid", "00000000-0000-0000-0000-000000000099"})
    void anUnknownOrNonUuidFromSightingIdIsIgnored(String id) {
        // The contract types from_sighting_id as a plain string, so a non-UUID is an unknown pin, not a malformed field.
        ApiResponse r = claim(",\"from_sighting_id\":\"" + id + "\"");
        assertThat(r.status()).isEqualTo(201);
        assertThat(theClaim().get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isNull();
    }

    @Test
    void photosMustBeTheCallersClaimUploadsAndAtMostFive() {
        String mine = Photos.uploaded(helper, "claim", "claim-photo-1");
        assertThat(claim(",\"photo_urls\":[\"" + mine + "\"]").status()).isEqualTo(201);
        assertThat(List.of(theClaim().get(RECOVERY_CLAIM.PHOTO_URLS))).containsExactly(mine);
        db.deleteFrom(RECOVERY_CLAIM).execute();
        String forASighting = Photos.uploaded(helper, "sighting", "claim-photo-2");
        assertThat(claim(",\"photo_urls\":[\"" + forASighting + "\"]").json().at("/error/fields").has("photo_urls")).isTrue();
        String six = String.join(",", java.util.Collections.nCopies(6, "\"" + mine + "\""));
        assertThat(claim(",\"photo_urls\":[" + six + "]").json().at("/error/fields").has("photo_urls")).isTrue();
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @ParameterizedTest(name = "phone {0}")
    @CsvSource(nullValues = "null", value = {"null", "+5716012345", "3001112233", "+999123"})
    void thePhoneIsRequiredAndASupportedMobile(String phone) {
        ApiResponse r = claim(helper, "7K3PQ", "{\"phone\":" + (phone == null ? "null" : "\"" + phone + "\"") + "}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void anAbsentPhoneIsAJacksonErrorBeforeAnyLookup() {
        ApiResponse r = claim(helper, "ZZZZZ", "{}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
    }

    @Test
    void aPurgedCodeIsGoneAndAnUnknownOneNotFound() {
        cases.purge("GONE5");
        assertThat(claim(helper, "GONE5", "{\"phone\":\"+573001112233\"}").errorCode()).isEqualTo("gone");
        assertThat(claim(helper, "ZZZZZ", "{\"phone\":\"+573001112233\"}").errorCode()).isEqualTo("not_found");
        assertThat(claim(helper, "bad!", "{\"phone\":\"+573001112233\"}").errorCode()).isEqualTo("not_found");
    }

    @Test
    void withoutASessionItIsUnauthorizedAndNothingIsStored() {
        ApiResponse r = claim(clients.newBrowser(), "7K3PQ", "{\"phone\":\"+573001112233\"}");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void theHappyPathIsFourStatementsARepeatTooAndTheWorstPathEight() {
        ApiResponse plain = cold(() -> claim(""));
        assertThat(plain.statements()).as("%s", plain.statements()).hasSize(4);   // session, pre-read, supported_countries, upsert
        ApiResponse repeat = cold(() -> claim(""));
        assertThat(repeat.statements()).as("the refresh is the same one statement: %s", repeat.statements()).hasSize(4);
        db.deleteFrom(RECOVERY_CLAIM).execute();
        // Worst: expired inside the window, the pet has another active case, a linked pin and a photo.
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", NOW.minus(Duration.ofDays(1)));
        UUID pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), andres, "9".repeat(64), null, "visible");
        String photo = Photos.uploaded(helper, "claim", "worst-path");
        ApiResponse worst = cold(() -> claim(",\"from_sighting_id\":\"" + pin + "\",\"photo_urls\":[\"" + photo + "\"]"));
        assertThat(worst.errorCode()).as(worst.body()).isEqualTo("active_case_exists");
        // session, pre-read, supported_countries, pin read, upload lookup, reactivation (0 rows), upsert (empty), re-read
        assertThat(worst.statements()).as("%s", worst.statements()).hasSize(8);
    }
}
