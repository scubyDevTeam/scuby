package co.scuby.identity;

import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.GoogleTestKeys;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class GoogleSignInTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired GoogleTestKeys keys;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired RecordingEmailSender emails;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    private ApiResponse google(String credential) {
        return api.post("/auth/google", "{\"credential\":\"" + credential + "\"}");
    }

    private Map<String, Object> claims() {
        return GoogleTestKeys.claims("google-sub-1", "carolina@correo.co", clock.instant());
    }

    @Test
    void aValidTokenSignsInAndCreatesTheAccountNamedByGoogle() {
        ApiResponse r = google(keys.token(claims()));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).isEqualTo("Carolina Mejía");
        assertThat(r.str("/email")).isEqualTo("carolina@correo.co");
        assertThat(api.get("/session").status()).isEqualTo(200);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
    }

    @Test
    void theSameGoogleAccountIsTheSamePerson() {
        String first = google(keys.token(claims())).str("/id");
        String second = clients.newBrowser().post("/auth/google", "{\"credential\":\"" + keys.token(claims()) + "\"}").str("/id");
        assertThat(second).isEqualTo(first);
    }

    @Test
    void aFirstGoogleSignInLinksToTheAccountWithThatEmail() {
        api.post("/auth/email/start", "{\"email\":\"carolina@correo.co\"}");
        String viaEmail = api.post("/auth/email/verify",
                "{\"email\":\"carolina@correo.co\",\"code\":\"" + emails.lastCodeFor("carolina@correo.co") + "\"}").str("/id");
        String viaGoogle = clients.newBrowser().post("/auth/google", "{\"credential\":\"" + keys.token(claims()) + "\"}").str("/id");
        assertThat(viaGoogle).isEqualTo(viaEmail);
        assertThat(db.fetchCount(PERSON)).isEqualTo(1);
    }

    @Test
    void anUnverifiedEmailIsRefused() {
        var c = claims();
        c.put("email_verified", false);
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anotherAppsTokenIsRefused() {
        var c = claims();
        c.put("aud", "someone-elses-client-id");
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aForeignIssuerIsRefused() {
        var c = claims();
        c.put("iss", "https://evil.example");
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anExpiredTokenIsRefused() {
        String token = keys.token(claims());
        clock.advance(Duration.ofHours(2));
        assertThat(google(token).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aTokenSignedByAnotherKeyIsRefused() {
        assertThat(google(keys.tokenSignedByAnotherKey(claims())).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void garbageIsRefused() {
        assertThat(google("not-a-jwt").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aTokenWithoutExpiryIsRefused() {
        var c = claims();
        c.remove("exp");
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anAccountLinkedToAnotherGoogleIdentityIsNotTakenOver() {
        String owner = google(keys.token(claims())).str("/id");                     // sub-1 owns carolina@correo.co
        var other = GoogleTestKeys.claims("google-sub-2", "carolina@correo.co", clock.instant());
        ApiResponse r = clients.newBrowser().post("/auth/google", "{\"credential\":\"" + keys.token(other) + "\"}");
        assertThat(r.errorCode()).isEqualTo("unauthorized");
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
        assertThat(db.fetchOne(PERSON).getId().toString()).isEqualTo(owner);
    }

    @Test
    void aVeryLongGoogleNameIsCutToEightyCharacters() {
        var c = claims();
        c.put("name", "Ñ".repeat(120));
        ApiResponse r = google(keys.token(c));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).hasSize(80);
    }

    @Test
    void signingInWhileSignedInEndsTheOldSessionUnderTheCeiling() {
        google(keys.token(claims()));
        String first = api.cookie("__Host-session").orElseThrow();
        ApiResponse again = google(keys.token(claims()));                           // lookup + DELETE on top
        assertThat(again.status()).isEqualTo(200);
        assertThat(api.cookie("__Host-session")).isPresent().get().isNotEqualTo(first);
    }

    @Test
    void aGoogleAccountWithoutANameIsNamedFromItsEmail() {
        var c = claims();
        c.remove("name");
        assertThat(google(keys.token(c)).str("/display_name")).isEqualTo("Carolina");
    }

    @Test
    void aLongNameOfSurrogatePairsIsCutWithoutSplittingACharacter() {
        var c = claims();
        c.put("name", "\uD83D\uDC15".repeat(100));
        ApiResponse r = google(keys.token(c));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name").codePointCount(0, r.str("/display_name").length())).isEqualTo(80);
    }

    @Test
    void concurrentFirstSignInsOfTheSameGoogleAccountEndWithOneLinkedAccount() throws Exception {
        for (int round = 0; round < 5; round++) {
            testDb.reset();
            var results = race(List.of("google-sub-1", "google-sub-1"));
            assertThat(results).extracting(ApiResponse::status).containsOnly(200);
            assertThat(results.get(0).str("/id")).isEqualTo(results.get(1).str("/id"));
            assertThat(db.fetchCount(PERSON)).isEqualTo(1);
            assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
        }
    }

    @Test
    void concurrentFirstSignInsOfTwoGoogleIdentitiesWithOneEmailLinkExactlyOne() throws Exception {
        for (int round = 0; round < 5; round++) {
            testDb.reset();
            var results = race(List.of("google-sub-1", "google-sub-2"));
            assertThat(results).extracting(ApiResponse::status).containsExactlyInAnyOrder(200, 401);
            assertThat(db.fetchCount(PERSON)).isEqualTo(1);
            assertThat(db.fetchOne(PERSON).getGoogleSub()).isIn("google-sub-1", "google-sub-2");
        }
    }

    private List<ApiResponse> race(List<String> subs) throws Exception {
        var pool = Executors.newFixedThreadPool(subs.size());
        try {
            var barrier = new CyclicBarrier(subs.size());
            List<Future<ApiResponse>> futures = subs.stream().map(sub -> {
                String token = keys.token(GoogleTestKeys.claims(sub, "carolina@correo.co", clock.instant()));
                ApiClient browser = clients.newBrowser();
                return pool.submit(() -> {
                    barrier.await();
                    return browser.post("/auth/google", "{\"credential\":\"" + token + "\"}");
                });
            }).toList();
            var out = new java.util.ArrayList<ApiResponse>();
            for (var f : futures) out.add(f.get());
            return out;
        } finally {
            pool.shutdownNow();
        }
    }
}
