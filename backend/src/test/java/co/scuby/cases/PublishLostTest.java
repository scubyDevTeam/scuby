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
        for (int i = 0; i < 4; i++) {           // max-per-number is 4 in 24 h; each resend waits out the 60 s cooldown
            assertThat(publish(PublishBodies.kira(PHONE, null)).str("/phone_step")).isEqualTo("otp");
            clock.advance(Duration.ofSeconds(61));
        }
        ApiResponse capped = publish(PublishBodies.kira(PHONE, null));
        assertThat(capped.status()).isEqualTo(429);
        assertThat(capped.errorCode()).isEqualTo("rate_limited");
        assertThat(db.fetchCount(LOST_CASE)).isZero();
        assertThat(db.fetchCount(PET)).isZero();
        assertThat(sms.sent()).hasSize(4);
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

    /**
     * Two taps on one account: the second waits on the person lock inside the phone step. Once it gets the lock the
     * first tap's case is committed, so the second must answer 409 and send no SMS (its re-check ran after the wait).
     */
    @Test
    void aPublishThatWaitedOnThePersonLockSeesTheCaseCommittedMeanwhile() throws Exception {
        String code = publishVerified();
        UUID petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1();
        db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").execute();
        int before = sms.sent().size();

        var pool = Executors.newFixedThreadPool(2);
        var holds = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            Future<?> firstTap = pool.submit(() -> tx.executeWithoutResult(s -> {
                db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).forUpdate().fetch();
                holds.countDown();
                try { release.await(30, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new IllegalStateException(e); }
                db.update(LOST_CASE).set(LOST_CASE.STATUS, "active").where(LOST_CASE.PET_ID.eq(petId)).execute();
            }));
            assertThat(holds.await(30, TimeUnit.SECONDS)).isTrue();
            Future<ApiResponse> secondTap = pool.submit(() -> publish(PublishBodies.withPetId(petId.toString(), "+573001234567")));
            awaitBlockedOn("person");
            release.countDown();
            firstTap.get(30, TimeUnit.SECONDS);
            ApiResponse r = secondTap.get(30, TimeUnit.SECONDS);
            assertThat(r.errorCode()).isEqualTo("active_case_exists");
            assertThat(r.str("/error/details/case_code")).isEqualTo(code);
            assertThat(sms.sent()).hasSize(before);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        assertThat(clients.newBrowser().post("/lost-cases", PublishBodies.kira(PHONE, null)).status()).isEqualTo(401);
    }
}
