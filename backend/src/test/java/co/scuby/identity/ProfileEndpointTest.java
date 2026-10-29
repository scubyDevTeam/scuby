package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class ProfileEndpointTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired DSLContext db;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        ApiResponse r = api.get("/me/profile");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aNewAccountHasDefaultsAndEveryFieldPresent() {
        accounts.signIn(api, "ana.gomez@correo.co");
        ApiResponse r = api.get("/me/profile");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).isEqualTo("ana.gomez");
        assertThat(r.str("/email")).isEqualTo("ana.gomez@correo.co");
        assertThat(r.isNull("/phone")).isTrue();
        assertThat(r.isNull("/city")).isTrue();
        assertThat(r.isNull("/bio")).isTrue();
        assertThat(r.isNull("/photo_url")).isTrue();
        for (String vertical : new String[] {"lost", "found", "adoption", "help"}) {
            assertThat(r.json().at("/notification_prefs/" + vertical).asBoolean()).as(vertical).isTrue();
        }
    }

    @Test
    void aStoredButUnverifiedNumberIsNotShown() {
        UUID id = accounts.signIn(api, "ana.gomez@correo.co");
        db.update(PERSON).set(PERSON.PHONE, "+573007152284").where(PERSON.ID.eq(id)).execute();
        assertThat(api.get("/me/profile").isNull("/phone")).isTrue();
    }

    @Test
    void theVerifiedNumberIsShown() {
        accounts.signIn(api, "ana.gomez@correo.co");
        api.post("/me/phone", "{\"phone\":\"+573000000003\"}");                       // a test number: fixed code
        api.post("/me/phone/verify", "{\"phone\":\"+573000000003\",\"code\":\"123456\"}");
        assertThat(api.get("/me/profile").str("/phone")).isEqualTo("+573000000003");
    }

    @Test
    void eachAccountSeesOnlyItsOwnProfile() {
        accounts.signIn(api, "ana.gomez@correo.co");
        ApiClient other = clients.newBrowser();
        accounts.signIn(other, "carolina@correo.co");
        assertThat(api.get("/me/profile").str("/email")).isEqualTo("ana.gomez@correo.co");
        assertThat(other.get("/me/profile").str("/email")).isEqualTo("carolina@correo.co");
    }
}
