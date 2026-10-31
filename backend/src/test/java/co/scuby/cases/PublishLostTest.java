package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.PublishBodies;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.util.UUID;

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

    @Test
    void nobodySignedInIsUnauthorized() {
        assertThat(clients.newBrowser().post("/lost-cases", PublishBodies.kira(PHONE, null)).status()).isEqualTo(401);
    }
}
