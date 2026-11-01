package co.scuby.identity;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
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
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

/** PATCH /me/profile (docs/eng/auth.md · Profile; spec §4.12). */
@IntegrationTest
class ProfileUpdateTest {

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient api;
    UUID ana;

    @BeforeEach
    void setUp() {
        api = clients.newBrowser();
        ana = accounts.signIn(api, "ana.gomez@correo.co");
        db.update(PERSON).set(PERSON.CITY, "Medellín").set(PERSON.BIO, "Hola").where(PERSON.ID.eq(ana)).execute();
    }

    private ApiResponse update(String json) {
        return api.patch("/me/profile", json);
    }

    private Record person() {
        return db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        // Not the flags, and not the dev media store (its clear() deletes the stored photos the call is about).
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags) && !c.getClass().getSimpleName().equals("LocalMediaStore"))
              .forEach(ClearableCache::clear);
        return call.get();
    }

    private void assertUnchanged() {
        Record p = person();
        assertThat(p.get(PERSON.DISPLAY_NAME)).isEqualTo("ana.gomez");
        assertThat(p.get(PERSON.DISPLAY_NAME_CHOSEN)).isFalse();
        assertThat(p.get(PERSON.CITY)).isEqualTo("Medellín");
        assertThat(p.get(PERSON.BIO)).isEqualTo("Hola");
        assertThat(p.get(PERSON.PHOTO_URL)).isNull();
    }

    @Test
    void sentFieldsAreStoredTheNameTrimmedAndChosenAndTheAnswerIsTheProfile() {
        ApiResponse r = update("{\"display_name\":\"  Ana María Gómez \",\"city\":\"Envigado\",\"bio\":\"Rescatista de gatos en Envigado.\","
                + "\"notification_prefs\":{\"lost\":true,\"found\":false,\"adoption\":false,\"help\":true}}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).isEqualTo("Ana María Gómez");
        assertThat(r.str("/email")).isEqualTo("ana.gomez@correo.co");
        assertThat(r.str("/city")).isEqualTo("Envigado");
        assertThat(r.str("/bio")).isEqualTo("Rescatista de gatos en Envigado.");
        assertThat(r.json().at("/notification_prefs/found").asBoolean()).isFalse();
        assertThat(r.json().at("/notification_prefs/help").asBoolean()).isTrue();
        Record p = person();
        assertThat(p.get(PERSON.DISPLAY_NAME)).isEqualTo("Ana María Gómez");
        assertThat(p.get(PERSON.DISPLAY_NAME_CHOSEN)).isTrue();
        assertThat(p.get(PERSON.NOTIFY_ADOPTION)).isFalse();
        assertThat(api.get("/me/profile").body()).isEqualTo(r.body());
    }

    @Test
    void sendingTheCurrentNameUnchangedStillMarksItChosenAndItBecomesPublic() {
        cases.luna(ana);
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").str("/contact/display_name")).isEqualTo("Alguien");
        assertThat(update("{\"display_name\":\"ana.gomez\"}").status()).isEqualTo(200);
        assertThat(person().get(PERSON.DISPLAY_NAME_CHOSEN)).isTrue();
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").str("/contact/display_name")).isEqualTo("ana.gomez");
    }

    @Test
    void theNameIsReadLiveOnEveryCaseOfThePerson() {
        cases.luna(ana);
        cases.lostCase(ana, "TOB22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600));
        update("{\"display_name\":\"Ana María Gómez\"}");
        for (String code : new String[] {"7K3PQ", "TOB22"}) {
            assertThat(clients.newBrowser().get("/cases/{code}", code).str("/contact/display_name")).as(code).isEqualTo("Ana M.");
        }
    }

    @Test
    void absentFieldsStayAndAnEmptyBodyAnswersTheProfileWithoutAWrite() {
        ApiResponse r = cold(() -> update("{}"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/city")).isEqualTo("Medellín");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(2);   // session, person read
        assertUnchanged();
        update("{\"city\":\"Bello\"}");
        assertThat(person().get(PERSON.BIO)).isEqualTo("Hola");
        assertThat(person().get(PERSON.DISPLAY_NAME_CHOSEN)).as("only sending a name marks it chosen").isFalse();
    }

    @Test
    void nullClearsCityBioAndPhoto() {
        db.update(PERSON).set(PERSON.PHOTO_URL, "http://localhost/dev-media/" + "c".repeat(64) + ".jpg").where(PERSON.ID.eq(ana)).execute();
        ApiResponse r = update("{\"city\":null,\"bio\":null,\"photo_url\":null}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.isNull("/city")).isTrue();
        assertThat(r.isNull("/bio")).isTrue();
        assertThat(r.isNull("/photo_url")).isTrue();
        assertThat(person().get(PERSON.PHOTO_URL)).isNull();
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "{\"display_name\":\"   \"}                                                         | display_name",
            "{\"display_name\":null}                                                            | display_name",
            "{\"city\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"} | city",
            "{\"bio\":\"Escríbeme a wa.me/573001112233\"}                                       | bio",
            "{\"bio\":\"Mi web: ana.com\"}                                                      | bio",
            "{\"notification_prefs\":null}                                                      | notification_prefs",
            "{\"notification_prefs\":{\"lost\":null,\"found\":true,\"adoption\":true,\"help\":true}} | notification_prefs.lost",
            "{\"photo_url\":\" \"}                                                              | photo_url",
    })
    void aBrokenFieldIsValidationFailedNamingItAndNothingIsWritten(String json, String field) {
        ApiResponse r = update(json);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has(field)).as(r.body()).isTrue();
        assertUnchanged();
    }

    @Test
    void lengthsAreCharactersLikePostgres() {
        assertThat(update("{\"display_name\":\"" + "🐶".repeat(80) + "\",\"bio\":\"" + "a".repeat(280) + "\"}").status()).isEqualTo(200);
        assertThat(update("{\"display_name\":\"" + "a".repeat(81) + "\"}").json().at("/error/fields").has("display_name")).isTrue();
        assertThat(update("{\"bio\":\"" + "a".repeat(281) + "\"}").json().at("/error/fields").has("bio")).isTrue();
    }

    @Test
    void anAbsentNotificationSwitchIsAJacksonErrorNamingIt() {
        ApiResponse r = update("{\"notification_prefs\":{\"lost\":true,\"found\":true,\"adoption\":true}}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("notification_prefs.help")).as(r.body()).isTrue();
        assertUnchanged();
    }

    @Test
    void theCurrentPhotoIsAcceptedAsItIsWithoutAnUploadLookup() {
        String current = Photos.uploaded(api, "profile", "ana-current");
        db.update(PERSON).set(PERSON.PHOTO_URL, current).where(PERSON.ID.eq(ana)).execute();
        db.execute("DELETE FROM scuby.upload");   // its slot is gone: only "it is the current one" can accept it now
        ApiResponse r = cold(() -> update("{\"photo_url\":\"" + current + "\"}"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/photo_url")).isEqualTo(current);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(3);   // session, person read, update
    }

    @Test
    void aNewPhotoMustBeTheCallersProfileUpload() {
        String mine = Photos.uploaded(api, "profile", "ana-new");
        ApiResponse ok = cold(() -> update("{\"photo_url\":\"" + mine + "\"}"));
        assertThat(ok.status()).as(ok.body()).isEqualTo(200);
        assertThat(ok.str("/photo_url")).isEqualTo(mine);
        assertThat(ok.statements()).as("the worst path: %s", ok.statements()).hasSize(4);   // session, person read, upload lookup, update
        String forAPet = Photos.uploaded(api, "pet", "ana-pet");
        ApiClient other = clients.newBrowser();
        accounts.signIn(other, "laura@correo.co");
        String someoneElses = Photos.uploaded(other, "profile", "laura-photo");
        for (String url : new String[] {forAPet, someoneElses, "http://localhost/dev-media/" + "0".repeat(64) + ".jpg"}) {
            ApiResponse r = update("{\"photo_url\":\"" + url + "\"}");
            assertThat(r.status()).as(url).isEqualTo(422);
            assertThat(r.json().at("/error/fields").has("photo_url")).isTrue();
        }
        assertThat(person().get(PERSON.PHOTO_URL)).isEqualTo(mine);
    }

    @Test
    void thePhoneInTheAnswerIsTheVerifiedOne() {
        db.update(PERSON).set(PERSON.PHONE, "+573007152284").where(PERSON.ID.eq(ana)).execute();
        assertThat(update("{\"city\":\"Bello\"}").isNull("/phone")).isTrue();
        db.update(PERSON).set(PERSON.PHONE_VERIFIED_AT, MutableClock.START.atOffset(ZoneOffset.UTC)).where(PERSON.ID.eq(ana)).execute();
        assertThat(update("{\"city\":\"Bello\"}").str("/phone")).isEqualTo("+573007152284");
    }

    @Test
    void eachAccountUpdatesOnlyItselfAndNobodySignedInIsUnauthorized() {
        ApiClient other = clients.newBrowser();
        UUID laura = accounts.signIn(other, "laura@correo.co");
        other.patch("/me/profile", "{\"city\":\"Bello\"}");
        assertThat(person().get(PERSON.CITY)).isEqualTo("Medellín");
        assertThat(db.select(PERSON.CITY).from(PERSON).where(PERSON.ID.eq(laura)).fetchOne(PERSON.CITY)).isEqualTo("Bello");
        ApiResponse anon = clients.newBrowser().patch("/me/profile", "{\"city\":\"Bello\"}");
        assertThat(anon.status()).isEqualTo(401);
        assertUnchanged();
    }
}
