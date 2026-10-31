package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PublishBodies;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class PublishLostTest {

    static final String PHONE = "+573007152284";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingSmsSender sms;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;
    @Autowired MutableClock clock;

    ApiClient api;
    UUID ana;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        ana = accounts.signIn(api, "ana.gomez@correo.co");
    }

    private ApiResponse publish(String body) {
        return api.post("/lost-cases", body);
    }

    private String publishVerified() {
        publish(PublishBodies.kira(PHONE, null));
        return publish(PublishBodies.kira(PHONE, sms.lastCodeFor(PHONE))).str("/code");
    }

    @Test
    void asksForTheSmsCodeFirstThenPublishesEverythingInOneGo() {
        ApiResponse first = publish(PublishBodies.kira(PHONE, null));
        assertThat(first.status()).isEqualTo(200);
        assertThat(first.str("/phone_step")).isEqualTo("otp");
        assertThat(db.fetchCount(LOST_CASE)).isZero();
        assertThat(db.fetchCount(PET)).isZero();

        String wrong = sms.lastCodeFor(PHONE).equals("000000") ? "111111" : "000000";
        assertThat(publish(PublishBodies.kira(PHONE, wrong)).errorCode()).isEqualTo("invalid_code");

        ApiResponse published = publish(PublishBodies.kira(PHONE, sms.lastCodeFor(PHONE)));
        assertThat(published.str("/code")).matches("^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$");
        var row = db.selectFrom(LOST_CASE).fetchOne();
        assertThat(row.getStatus()).isEqualTo("active");
        assertThat(row.getCreatedBy()).isEqualTo(ana);
        assertThat(row.getContactPhone()).isEqualTo(PHONE);
        assertThat(row.getLastSeenRadiusM()).isEqualTo(300.0);
        assertThat(row.getPlaceName()).isNull();                       // reverse_geocoding off
        assertThat(db.fetchExists(RESPONSIBILITY_LINK, RESPONSIBILITY_LINK.PERSON_ID.eq(ana), RESPONSIBILITY_LINK.PET_ID.eq(row.getPetId()))).isTrue();
        assertThat(db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne().getPhoneVerifiedAt()).isNotNull();
    }

    /** O24 + review I4: publisher_phone_otp off publishes with the number unverified, and an unverified number is never public. */
    @Test
    void withTheOtpFlagOffTheCaseIsPublishedButItsUnverifiedNumberHasNoPublicContact() {
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('publisher_phone_otp', ?, false, 'test')", ana);
        String code = publish(PublishBodies.kira(PHONE, null)).str("/code");
        var row = db.selectFrom(LOST_CASE).where(LOST_CASE.CODE.eq(code)).fetchOne();
        assertThat(row.getContactPhone()).isEqualTo(PHONE);                // stored for the owner
        assertThat(row.getContactPhoneVerified()).isFalse();
        for (ApiClient viewer : java.util.List.of(clients.newBrowser(), api)) {
            ApiResponse r = viewer.get("/cases/{code}", code);
            assertThat(r.isNull("/contact/whatsapp_url")).isTrue();
            assertThat(r.body()).doesNotContain(PHONE.substring(1));
        }
    }

    @Test
    void aVerifiedPublishIsMarkedVerifiedAndGetsItsPublicWhatsappLink() {
        String code = publishVerified();
        assertThat(db.selectFrom(LOST_CASE).where(LOST_CASE.CODE.eq(code)).fetchOne().getContactPhoneVerified()).isTrue();
        assertThat(clients.newBrowser().get("/cases/{code}", code).str("/contact/whatsapp_url")).isEqualTo("https://wa.me/573007152284");
    }

    /** Contract: pet_id, phone, otp_code, pet.marks and pet.chip_number are required but nullable: absent is refused, null is fine. */
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
            "\"pet_id\":null,,                pet_id",
            "\"phone\":null,,                 phone",
            "\"otp_code\":null,,              otp_code",
            "\"marks\":null,,                 pet.marks",
            "\"chip_number\":null,,           pet.chip_number"})
    void anAbsentRequiredNullableFieldIsValidationFailedNamingIt(String fragment, String ignored, String field) {
        db.update(PERSON).set(PERSON.PHONE, PHONE).set(PERSON.PHONE_VERIFIED_AT, clock.instant().atOffset(java.time.ZoneOffset.UTC))
          .where(PERSON.ID.eq(ana)).execute();                    // so null phone and null code are a complete body
        String full = PublishBodies.kira(null, null);
        assertThat(full).contains(fragment);
        tools.jackson.databind.node.ObjectNode tree = (tools.jackson.databind.node.ObjectNode) new tools.jackson.databind.json.JsonMapper().readTree(full);
        if (field.startsWith("pet.")) ((tools.jackson.databind.node.ObjectNode) tree.get("pet")).remove(field.substring(4));
        else tree.remove(field);
        String without = tree.toString();
        ApiResponse r = publish(without);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has(field)).as("fields name %s: %s", field, r.body()).isTrue();
        assertThat(db.fetchCount(LOST_CASE)).isZero();
        assertThat(sms.sent()).isEmpty();
        assertThat(publish(full).status()).as("the same body with the field present and null").isEqualTo(200);
    }

    @Test
    void theNextPublishWithTheVerifiedNumberGoesStraightThrough() {
        publishVerified();
        int before = sms.sent().size();
        assertThat(publish(PublishBodies.kira(null, null)).str("/code")).isNotNull();
        assertThat(sms.sent()).hasSize(before);
    }

    @Test
    void aSecondActiveCaseForTheSamePetNamesTheOpenOne() {
        String code = publishVerified();
        String petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1().toString();
        ApiResponse r = publish(PublishBodies.withPetId(petId, null));
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo(code);
    }

    @Test
    void someoneElsesPetOrAMadeUpIdIsNotFound() {
        publishVerified();
        String petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1().toString();
        ApiClient bob = clients.newBrowser();
        accounts.signIn(bob, "bob@correo.co");
        assertThat(bob.post("/lost-cases", PublishBodies.withPetId(petId, PHONE)).errorCode()).isEqualTo("not_found");
        assertThat(publish(PublishBodies.withPetId("pet-1", null)).errorCode()).isEqualTo("not_found");
    }

    @Test
    void noNumberAnywhereIsPhoneRequired() {
        assertThat(publish(PublishBodies.kira(null, null)).errorCode()).isEqualTo("phone_required");
    }

    @Test
    void withTheFlagOffTheCaseGoesLiveWithTheNumberUnverified() {
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('publisher_phone_otp', ?, false, 'test')", ana);
        ApiResponse r = publish(PublishBodies.kira(PHONE, null));
        assertThat(r.str("/code")).isNotNull();
        assertThat(sms.sent()).isEmpty();
        assertThat(db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne().getPhoneVerifiedAt()).isNull();
    }

    @Test
    void onlyTheCallersProcessedPetPhotosAreAccepted() {
        byte[] bytes = "kira-photo".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        String url = api.post("/uploads", """
                {"purpose":"pet","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        String body = PublishBodies.kira(PHONE, null, "[\"" + url + "\"]", "2026-10-14T08:00:00-05:00", 300);

        ApiResponse unprocessed = publish(body);
        assertThat(unprocessed.errorCode()).isEqualTo("validation_failed");
        assertThat(unprocessed.json().at("/error/fields").has("pet.photo_urls")).isTrue();

        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        assertThat(publish(body).str("/phone_step")).isEqualTo("otp");

        ApiClient bob = clients.newBrowser();
        accounts.signIn(bob, "bob@correo.co");
        assertThat(bob.post("/lost-cases", body).json().at("/error/fields").has("pet.photo_urls")).isTrue();
    }

    /** The phone step runs after every other check, so a refused publish never burns the SMS code (A1 · PublisherPhone: prepare, then resolve). */
    @Test
    void aPublishRefusedForAnotherReasonLeavesTheSmsCodeUsable() {
        publish(PublishBodies.kira(PHONE, null));
        String code = sms.lastCodeFor(PHONE);
        String foreignPhoto = PublishBodies.kira(PHONE, code, "[\"https://evil.example/x.jpg\"]", "2026-10-14T08:00:00-05:00", 300);
        assertThat(publish(foreignPhoto).errorCode()).isEqualTo("validation_failed");
        assertThat(publish(PublishBodies.kira(PHONE, code)).str("/code")).isNotNull();
    }

    @Test
    void theBodyIsCheckedAgainstTheContract() {
        assertThat(publish(PublishBodies.kira(PHONE, null, "[]", "2026-10-14T08:00:00-05:00", 6000)).errorCode())
                .isEqualTo("validation_failed");
        ApiResponse future = publish(PublishBodies.kira(PHONE, null, "[]", "2026-10-14T18:00:00Z", 300));
        assertThat(future.errorCode()).isEqualTo("validation_failed");
        assertThat(future.json().at("/error/fields").has("last_seen_at")).isTrue();
    }

    // ---- refused publishes: no SMS, no case ---------------------------------------------------------------

    @Test
    void aPublishRefusedForAnyReasonSendsNoSms() {
        String code = publishVerified();
        String petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1().toString();
        int before = sms.sent().size();
        String newNumber = "+573001234567";

        // active_case_exists
        assertThat(publish(PublishBodies.withPetId(petId, newNumber)).errorCode()).isEqualTo("active_case_exists");
        // not_found (someone else's pet)
        ApiClient bob = clients.newBrowser();
        accounts.signIn(bob, "bob@correo.co");
        assertThat(bob.post("/lost-cases", PublishBodies.withPetId(petId, newNumber)).errorCode()).isEqualTo("not_found");
        // validation_failed (photo that is not ours; last_seen_at in the future)
        assertThat(publish(PublishBodies.kira(newNumber, null, "[\"https://evil.example/x.jpg\"]", "2026-10-14T08:00:00-05:00", 300)).errorCode())
                .isEqualTo("validation_failed");
        assertThat(publish(PublishBodies.kira(newNumber, null, "[]", "2026-10-14T18:00:00Z", 300)).errorCode())
                .isEqualTo("validation_failed");

        assertThat(sms.sent()).hasSize(before);
        assertThat(db.fetchCount(LOST_CASE)).isEqualTo(1);
        assertThat(code).isNotNull();
    }

    @Test
    void theSmsCapAnswers429AndWritesNoCase() {
        for (int i = 0; i < 5; i++) {           // max-per-number is 5 in a rolling 24 h; each resend waits out the 60 s cooldown
            assertThat(publish(PublishBodies.kira(PHONE, null)).str("/phone_step")).isEqualTo("otp");
            clock.advance(Duration.ofSeconds(61));
        }
        ApiResponse capped = publish(PublishBodies.kira(PHONE, null));
        assertThat(capped.status()).isEqualTo(429);
        assertThat(capped.errorCode()).isEqualTo("rate_limited");
        assertThat(db.fetchCount(LOST_CASE)).isZero();
        assertThat(db.fetchCount(PET)).isZero();
        assertThat(sms.sent()).hasSize(5);
    }

    // ---- concurrency ----------------------------------------------------------------------------------------

    private void awaitBlockedOn(String sqlFragment) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            Integer waiting = db.fetchOne("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query ilike ?",
                    "%" + sqlFragment + "%").get(0, Integer.class);
            if (waiting != null && waiting > 0) return;
            Thread.sleep(20);
        }
        throw new AssertionError("no backend ever blocked on " + sqlFragment);
    }

    /** Another transaction holds an (uncommitted) active case for the pet while this publish reaches its INSERT. */
    @Test
    void losingTheOneActiveCasePerPetRaceAnswers409NotA500() throws Exception {
        String code = publishVerified();
        UUID petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1();
        db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").execute();   // the rival will reopen it

        var pool = Executors.newFixedThreadPool(2);
        var rivalHolds = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            Future<?> rival = pool.submit(() -> tx.executeWithoutResult(s -> {
                db.update(LOST_CASE).set(LOST_CASE.STATUS, "active").where(LOST_CASE.PET_ID.eq(petId)).execute();
                rivalHolds.countDown();
                try { release.await(30, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new IllegalStateException(e); }
            }));
            assertThat(rivalHolds.await(30, TimeUnit.SECONDS)).isTrue();
            Future<ApiResponse> mine = pool.submit(() -> publish(PublishBodies.withPetId(petId.toString(), null)));
            awaitBlockedOn("lost_case");           // our INSERT waits on the rival's index entry
            release.countDown();
            rival.get(30, TimeUnit.SECONDS);
            ApiResponse r = mine.get(30, TimeUnit.SECONDS);
            assertThat(r.status()).isEqualTo(409);
            assertThat(r.errorCode()).isEqualTo("active_case_exists");
            assertThat(r.str("/error/details/case_code")).isEqualTo(code);
            assertThat(db.fetchCount(LOST_CASE)).isEqualTo(1);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    /** Two publishes of one pet started together by a barrier: one case, one 409 carrying its code, never a 500. */
    @Test
    void twoConcurrentPublishesForOnePetGiveOneCaseAndOne409() throws Exception {
        String first = publishVerified();
        UUID petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1();
        var pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 8; round++) {
                db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").execute();   // the pet is free again
                int casesBefore = db.fetchCount(LOST_CASE);
                var barrier = new java.util.concurrent.CyclicBarrier(2);
                var calls = java.util.List.of(
                        pool.submit(() -> { barrier.await(); return publish(PublishBodies.withPetId(petId.toString(), null)); }),
                        pool.submit(() -> { barrier.await(); return publish(PublishBodies.withPetId(petId.toString(), null)); }));
                java.util.List<ApiResponse> answers = new java.util.ArrayList<>();
                for (var f : calls) answers.add(f.get(30, TimeUnit.SECONDS));
                assertThat(answers).extracting(ApiResponse::status).as("round %d: %s", round, answers.stream().map(ApiResponse::body).toList())
                                   .containsExactlyInAnyOrder(200, 409);
                ApiResponse loser = answers.stream().filter(r -> r.status() == 409).findFirst().orElseThrow();
                ApiResponse winner = answers.stream().filter(r -> r.status() == 200).findFirst().orElseThrow();
                assertThat(loser.errorCode()).isEqualTo("active_case_exists");
                assertThat(loser.str("/error/details/case_code")).isEqualTo(winner.str("/code"));
                assertThat(db.fetchCount(LOST_CASE)).isEqualTo(casesBefore + 1);
                assertThat(db.fetchCount(LOST_CASE, LOST_CASE.STATUS.eq("active"))).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(first).isNotBlank();
    }

    /**
     * The correct code is consumed only after the case insert; the publish loses the one-active-case race
     * and rolls back. The code must still be usable (its attempt stays spent) once the pet is free again.
     */
    @Test
    void aCorrectCodeIsStillUsableAfterAPublishRefusedOnTheRace() throws Exception {
        publishVerified();
        UUID petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1();
        db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").execute();
        String other = "+573001234567";
        assertThat(api.post("/me/phone", "{\"phone\":\"" + other + "\"}").status()).isEqualTo(204);
        String code = sms.lastCodeFor(other);
        String body = PublishBodies.withPetId(petId.toString(), other).replace("\"otp_code\":null", "\"otp_code\":\"" + code + "\"");

        var pool = Executors.newFixedThreadPool(2);
        var rivalHolds = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            Future<?> rival = pool.submit(() -> tx.executeWithoutResult(s -> {
                db.update(LOST_CASE).set(LOST_CASE.STATUS, "active").where(LOST_CASE.PET_ID.eq(petId)).execute();
                rivalHolds.countDown();
                try { release.await(30, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new IllegalStateException(e); }
            }));
            assertThat(rivalHolds.await(30, TimeUnit.SECONDS)).isTrue();
            Future<ApiResponse> mine = pool.submit(() -> publish(body));
            awaitBlockedOn("lost_case");           // our INSERT waits on the rival's index entry
            release.countDown();
            rival.get(30, TimeUnit.SECONDS);
            ApiResponse refused = mine.get(30, TimeUnit.SECONDS);
            assertThat(refused.status()).isEqualTo(409);
            assertThat(refused.errorCode()).isEqualTo("active_case_exists");
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.PHONE_OTP)).as("the refused publish left the code in place").isEqualTo(1);

        db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").execute();
        ApiResponse again = publish(body);
        assertThat(again.status()).as("same code, second try: %s", again.body()).isEqualTo(200);
        assertThat(again.str("/code")).isNotBlank();
    }

    /**
     * The double tap of «Publicar» at the code step: the same correct SMS code, the same existing pet. Sequentially
     * and concurrently, one case is created and the other request is a 409 with the winner's case code, never a
     * 422 invalid_code and never a 500 (the code is consumed after the case insert, so the loser waits on the
     * unique index, not on the code row).
     */
    @Test
    void aDoubleTapWithTheSameCorrectCodeOnAnExistingPetGivesOneCaseAndOne409() throws Exception {
        publishVerified();
        UUID petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1();
        var pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 8; round++) {
                db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").execute();   // the pet is free again
                clock.advance(Duration.ofMinutes(2));
                String other = "+57300123450" + round;
                assertThat(api.post("/me/phone", "{\"phone\":\"" + other + "\"}").status()).isEqualTo(204);
                String body = PublishBodies.withPetId(petId.toString(), other)
                        .replace("\"otp_code\":null", "\"otp_code\":\"" + sms.lastCodeFor(other) + "\"");
                int casesBefore = db.fetchCount(LOST_CASE);
                java.util.List<ApiResponse> answers = new java.util.ArrayList<>();
                if (round % 2 == 0) {
                    answers.add(publish(body));
                    answers.add(publish(body));      // sequential: the pre-check answers 409
                } else {
                    var barrier = new java.util.concurrent.CyclicBarrier(2);
                    var calls = java.util.List.of(
                            pool.submit(() -> { barrier.await(); return publish(body); }),
                            pool.submit(() -> { barrier.await(); return publish(body); }));
                    for (var f : calls) answers.add(f.get(30, TimeUnit.SECONDS));
                }
                assertThat(answers).extracting(ApiResponse::status).as("round %d: %s", round, answers.stream().map(ApiResponse::body).toList())
                                   .containsExactlyInAnyOrder(200, 409);
                ApiResponse loser = answers.stream().filter(r -> r.status() == 409).findFirst().orElseThrow();
                ApiResponse winner = answers.stream().filter(r -> r.status() == 200).findFirst().orElseThrow();
                assertThat(loser.errorCode()).isEqualTo("active_case_exists");
                assertThat(loser.str("/error/details/case_code")).isEqualTo(winner.str("/code"));
                assertThat(db.fetchCount(LOST_CASE)).isEqualTo(casesBefore + 1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        assertThat(clients.newBrowser().post("/lost-cases", PublishBodies.kira(PHONE, null)).status()).isEqualTo(401);
    }

    @Test
    void moreThanSevenColoursIsValidationFailed() {
        String eight = "[\"black\",\"white\",\"brown\",\"tan\",\"gray\",\"yellow\",\"orange\",\"black\"]";
        ApiResponse r = publish(PublishBodies.kira(PHONE, null).replace("[\"brown\"]", eight));
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("pet.colors")).isTrue();
        assertThat(db.fetchCount(PET)).isZero();
    }

    @Test
    void repeatedColoursPublishAndAreStoredOnce() {
        String repeated = "[\"brown\",\"brown\",\"tan\",\"brown\"]";
        publish(PublishBodies.kira(PHONE, null).replace("[\"brown\"]", repeated));
        ApiResponse done = publish(PublishBodies.kira(PHONE, sms.lastCodeFor(PHONE)).replace("[\"brown\"]", repeated));
        assertThat(done.status()).isEqualTo(200);
        assertThat(db.selectFrom(PET).fetchOne().getColors()).containsExactly("brown", "tan");
        assertThat(api.get("/cases/{code}", done.str("/code")).json().at("/pet/colors").toString()).isEqualTo("[\"brown\",\"tan\"]");
    }
}
