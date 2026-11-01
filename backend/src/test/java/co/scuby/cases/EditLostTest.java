package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
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
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** PATCH /lost-cases/{code} (docs/product/04 · editing; spec §4.1) and the thin PATCH /cases/{code} (§4.2). */
@IntegrationTest
class EditLostTest {

    static final Instant NOW = MutableClock.START;
    static final String FIXTURE_PHOTO = "http://localhost/dev-media/" + "a".repeat(64) + ".jpg";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired co.scuby.support.TestDb testDb;

    ApiClient owner;
    ApiClient stranger;
    UUID carolina;
    UUID strangerId;
    UUID pet;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        strangerId = accounts.signIn(stranger, "stranger@correo.co");
        cases.luna(carolina);
        pet = cases.petOf("7K3PQ");
        db.update(PET).set(PET.MARKS, "Collar rojo").where(PET.ID.eq(pet)).execute();
        db.update(LOST_CASE).set(LOST_CASE.PLACE_NAME, "Laureles").where(LOST_CASE.CODE.eq("7K3PQ")).execute();
    }

    private ApiResponse edit(ApiClient as, String code, String json) {
        return as.patch("/lost-cases/{code}", json, code);
    }

    private Record luna() {
        return db.selectFrom(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne();
    }

    private Record thePet() {
        return db.selectFrom(PET).where(PET.ID.eq(pet)).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        testDb.cold();
        return call.get();
    }

    private void assertNothingChanged() {
        assertThat(thePet().get(PET.MARKS)).isEqualTo("Collar rojo");
        assertThat(List.of(thePet().get(PET.PHOTO_URLS))).containsExactly(FIXTURE_PHOTO);
        assertThat(luna().get(LOST_CASE.LAST_SEEN_RADIUS_M)).isEqualTo(100.0);
        assertThat(luna().get(LOST_CASE.PLACE_NAME)).isEqualTo("Laureles");
    }

    @Test
    void photosAndSignsChangeTheSharedPetAndShowOnEveryCaseOfIt() {
        cases.lostCaseForPet(carolina, pet, "OLD22", "reunited", NOW.minus(Duration.ofDays(60)));
        String newPhoto = Photos.uploaded(owner, "pet", "luna-edit-1");
        ApiResponse r = edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + FIXTURE_PHOTO + "\",\"" + newPhoto + "\"],\"marks\":\"Collar azul\"}");
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.body()).isEmpty();
        assertThat(thePet().get(PET.MARKS)).isEqualTo("Collar azul");
        assertThat(List.of(thePet().get(PET.PHOTO_URLS))).containsExactly(FIXTURE_PHOTO, newPhoto);
        for (String code : new String[] {"7K3PQ", "OLD22"}) {
            ApiResponse page = clients.newBrowser().get("/cases/{code}", code);
            assertThat(page.str("/pet/marks")).as(code).isEqualTo("Collar azul");
            assertThat(page.str("/pet/photo_urls/1")).as(code).isEqualTo(newPhoto);
        }
    }

    @Test
    void anExplicitNullClearsTheSigns() {
        assertThat(edit(owner, "7K3PQ", "{\"marks\":null}").status()).isEqualTo(204);
        assertThat(thePet().get(PET.MARKS)).isNull();
    }

    @Test
    void absentFieldsStayAsTheyAre() {
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_radius_m\":300}").status()).isEqualTo(204);
        assertThat(luna().get(LOST_CASE.LAST_SEEN_RADIUS_M)).isEqualTo(300.0);
        assertThat(luna().get(LOST_CASE.PLACE_NAME)).isEqualTo("Laureles");
        assertThat(luna().get(LOST_CASE.LAST_SEEN_LAT)).isEqualTo(6.2442);
        assertThat(thePet().get(PET.MARKS)).isEqualTo("Collar rojo");
        assertThat(List.of(thePet().get(PET.PHOTO_URLS))).containsExactly(FIXTURE_PHOTO);
    }

    @Test
    void aMovedZoneReSnapsThePublicCenterAndShowsTheGenericPlaceLabel() {
        // Both coordinates differ between the exact point and its snapped center, so a leak of either one is caught.
        GeoPoint exact = new GeoPoint(6.3047, -75.6053);
        GeoPoint snapped = LocationPrecisionDerivation.publicCenter(exact);
        assertThat(snapped.lat()).isNotEqualTo(exact.lat());
        assertThat(snapped.lng()).isNotEqualTo(exact.lng());
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_point\":{\"lat\":6.3047,\"lng\":-75.6053}}").status()).isEqualTo(204);
        Record row = luna();
        assertThat(row.get(LOST_CASE.LAST_SEEN_LAT)).isEqualTo(exact.lat());
        assertThat(row.get(LOST_CASE.LAST_SEEN_LNG)).isEqualTo(exact.lng());
        assertThat(row.get(LOST_CASE.LAST_SEEN_PUBLIC_LAT)).isEqualTo(snapped.lat());
        assertThat(row.get(LOST_CASE.LAST_SEEN_PUBLIC_LNG)).isEqualTo(snapped.lng());
        assertThat(row.get(LOST_CASE.PLACE_NAME)).isNull();
        ApiResponse pub = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(pub.json().at("/last_seen/center/lat").asDouble()).isEqualTo(snapped.lat());
        assertThat(pub.json().at("/last_seen/center/lng").asDouble()).isEqualTo(snapped.lng());
        assertThat(pub.str("/last_seen/place_name")).isEqualTo("Zona marcada en el mapa");
        assertThat(stranger.get("/cases/{code}", "7K3PQ").json().at("/last_seen/center/lat").asDouble()).isEqualTo(snapped.lat());
        ApiResponse own = owner.get("/cases/{code}", "7K3PQ");
        assertThat(own.json().at("/last_seen/center/lat").asDouble()).isEqualTo(exact.lat());
        assertThat(own.json().at("/last_seen/center/lng").asDouble()).isEqualTo(exact.lng());
    }

    @Test
    void theStoredPointIsNotAMoveAndKeepsThePlaceName() {
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_point\":{\"lat\":6.2442,\"lng\":-75.5812},\"last_seen_radius_m\":250}").status()).isEqualTo(204);
        assertThat(luna().get(LOST_CASE.PLACE_NAME)).isEqualTo("Laureles");
        assertThat(luna().get(LOST_CASE.LAST_SEEN_RADIUS_M)).isEqualTo(250.0);
    }

    @Test
    void lastSeenAtMayBeFiveMinutesAheadButNotMore() {
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_at\":\"2026-10-14T17:05:00Z\"}").status()).isEqualTo(204);
        assertThat(luna().get(LOST_CASE.LAST_SEEN_AT).toInstant()).isEqualTo(Instant.parse("2026-10-14T17:05:00Z"));
        ApiResponse r = edit(owner, "7K3PQ", "{\"last_seen_at\":\"2026-10-14T17:05:00.001Z\"}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("last_seen_at")).isTrue();
        assertThat(luna().get(LOST_CASE.LAST_SEEN_AT).toInstant()).isEqualTo(Instant.parse("2026-10-14T17:05:00Z"));
    }

    @Test
    void existingSightingsAreNotRevalidated() {
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), null, "3".repeat(64), null, "visible");
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_point\":{\"lat\":4.711,\"lng\":-74.07},\"last_seen_at\":\"2026-10-14T16:59:00Z\"}").status())
                .isEqualTo(204);
        assertThat(db.fetchCount(SIGHTING, SIGHTING.STATUS.eq("visible"))).isEqualTo(1);
    }

    @Test
    void anOpenClaimNeverBlocksAnEdit() {
        UUID andres = accounts.person("andres@correo.co");
        db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at) "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, '+573001112233', 'open', ?::timestamptz, ?::timestamptz)", andres, NOW.toString(), NOW.toString());
        assertThat(edit(owner, "7K3PQ", "{\"marks\":\"Collar azul\"}").status()).isEqualTo(204);
        assertThat(db.select(PET.MARKS).from(PET).where(PET.ID.eq(cases.petOf("7K3PQ"))).fetchOne(PET.MARKS)).isEqualTo("Collar azul");
        assertThat(db.select(co.scuby.db.generated.Tables.RECOVERY_CLAIM.STATUS).from(co.scuby.db.generated.Tables.RECOVERY_CLAIM)
                .fetchOne(co.scuby.db.generated.Tables.RECOVERY_CLAIM.STATUS)).as("the claim is untouched").isEqualTo("open");
    }

    @Test
    void anEditWritesNoOutboxRowAndBroadcastsNothing() {
        assertThat(edit(owner, "7K3PQ", "{\"marks\":\"Collar azul\",\"last_seen_point\":{\"lat\":6.25,\"lng\":-75.59}}").status()).isEqualTo(204);
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.OUTBOX_EVENTS)).as("an edit never re-broadcasts: L1 writes no outbox row").isZero();
    }

    @Test
    void anEmptyBodyIsANoOpOnAnActiveCaseWithNoWrite() {
        ApiResponse r = cold(() -> edit(owner, "7K3PQ", "{}"));
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(2);           // session, pre-read; no write
        assertNothingChanged();
    }

    @ParameterizedTest
    @CsvSource({"expired", "reunited", "cancelled"})
    void aCaseThatIsNotActiveCannotBeEditedEvenWithAnEmptyBody(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        assertThat(edit(owner, "7K3PQ", "{}").errorCode()).isEqualTo("invalid_transition");
        ApiResponse r = edit(owner, "7K3PQ", "{\"marks\":\"Collar azul\"}");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(thePet().get(PET.MARKS)).isEqualTo("Collar rojo");
    }

    @Test
    void aPhotoTheCallerDidNotUploadForThePetIsRefused() {
        String sightingPhoto = Photos.uploaded(owner, "sighting", "not-for-a-pet");
        for (String photo : new String[] {"http://localhost/dev-media/" + "0".repeat(64) + ".jpg", sightingPhoto,
                Photos.uploaded(stranger, "pet", "someone-elses")}) {
            ApiResponse r = edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + photo + "\"]}");
            assertThat(r.status()).as(photo).isEqualTo(422);
            assertThat(r.json().at("/error/fields").has("photo_urls")).isTrue();
        }
        assertNothingChanged();
    }

    @Test
    void aPhotoAlreadyOnAnotherOwnersPetIsRefused() {
        // The photo is on the stranger's pet, so it is not one of the edited pet's own photos: it needs the caller's upload, which it lacks.
        String strangersPhoto = Photos.uploaded(stranger, "pet", "stranger-pet-photo");
        cases.lostCase(strangerId, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        db.update(PET).set(PET.PHOTO_URLS, new String[] {strangersPhoto}).where(PET.ID.eq(cases.petOf("OTH22"))).execute();
        ApiResponse r = edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + FIXTURE_PHOTO + "\",\"" + strangersPhoto + "\"]}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("photo_urls")).isTrue();
        assertNothingChanged();
        assertThat(List.of(db.selectFrom(PET).where(PET.ID.eq(cases.petOf("OTH22"))).fetchOne().get(PET.PHOTO_URLS))).containsExactly(strangersPhoto);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {   // default quote character (') so the JSON's double quotes stay literal
            "{\"photo_urls\":[]}                                   | photo_urls",
            "{\"photo_urls\":null}                                 | photo_urls",
            "{\"photo_urls\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\"]} | photo_urls",
            "{\"photo_urls\":[\"\"]}                               | photo_urls",
            "{\"last_seen_point\":null}                            | last_seen_point",
            "{\"last_seen_point\":{\"lat\":91,\"lng\":0}}          | last_seen_point",
            "{\"last_seen_point\":{\"lat\":0}}                     | last_seen_point",
            "{\"last_seen_radius_m\":0}                            | last_seen_radius_m",
            "{\"last_seen_radius_m\":5000.5}                       | last_seen_radius_m",
            "{\"last_seen_radius_m\":null}                         | last_seen_radius_m",
            "{\"last_seen_at\":null}                               | last_seen_at",
    })
    void aBrokenFieldIsValidationFailedNamingItAndNothingIsWritten(String json, String field) {
        ApiResponse r = edit(owner, "7K3PQ", json);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has(field)).as(r.body()).isTrue();
        assertNothingChanged();
    }

    @Test
    void marksLongerThan500CharactersAreRefused() {
        ApiResponse r = edit(owner, "7K3PQ", "{\"marks\":\"" + "a".repeat(501) + "\"}");
        assertThat(r.json().at("/error/fields").has("marks")).isTrue();
        assertNothingChanged();
    }

    @Test
    void anUnknownOrMalformedCodeIsNotFoundSomeoneElseIsForbiddenNobodyIsUnauthorized() {
        assertThat(edit(owner, "ZZZZZ", "{\"marks\":\"x\"}").errorCode()).isEqualTo("not_found");
        assertThat(edit(owner, "bad!", "{\"marks\":\"x\"}").errorCode()).isEqualTo("not_found");
        assertThat(edit(stranger, "7K3PQ", "{\"marks\":\"x\"}").errorCode()).isEqualTo("forbidden");
        ApiResponse anon = clients.newBrowser().patch("/lost-cases/{code}", "{\"marks\":\"x\"}", "7K3PQ");
        assertThat(anon.status()).isEqualTo(401);
        assertNothingChanged();
    }

    @Test
    void theOtherVerticalsEditAnswersNotFoundForEveryCodeWithoutAQuery() {
        for (String code : new String[] {"7K3PQ", "ZZZZZ"}) {
            ApiResponse r = cold(() -> owner.patch("/cases/{code}", "{\"marks\":\"x\"}", code));
            assertThat(r.status()).as(code).isEqualTo(404);
            assertThat(r.errorCode()).isEqualTo("not_found");
            assertThat(r.statements()).as("only the session lookup").hasSize(1);
        }
        assertThat(clients.newBrowser().patch("/cases/{code}", "{}", "7K3PQ").status()).isEqualTo(401);
        assertNothingChanged();
    }

    @Test
    void theWorstPathIsFiveStatements() {
        String newPhoto = Photos.uploaded(owner, "pet", "luna-edit-worst");
        ApiResponse r = cold(() -> edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + newPhoto + "\"],\"marks\":\"Collar azul\","
                + "\"last_seen_point\":{\"lat\":6.30,\"lng\":-75.60},\"last_seen_radius_m\":400,\"last_seen_at\":\"2026-10-14T16:00:00Z\"}"));
        assertThat(r.status()).as(r.body()).isEqualTo(204);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(5);   // session, pre-read, upload lookup, pet update, case update
    }

    @Test
    void photosAlreadyOnThePetNeedNoUploadLookup() {
        ApiResponse r = cold(() -> edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + FIXTURE_PHOTO + "\"]}"));
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);   // session, pre-read, pet update, case update
    }
}
