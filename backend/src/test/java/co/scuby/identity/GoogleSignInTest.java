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
    @Autowired org.springframework.beans.factory.ObjectProvider<co.scuby.platform.cache.ClearableCache> caches;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    private ApiResponse emailSignIn(ApiClient browser, String email) {
        browser.post("/auth/email/start", "{\"email\":\"" + email + "\"}");
        return browser.post("/auth/email/verify",
                "{\"email\":\"" + email + "\",\"code\":\"" + emails.lastCodeFor(email) + "\"}");
    }

    private ApiResponse google(String credential) {
        return api.post("/auth/google", "{\"credential\":\"" + credential + "\"}");
    }

    private Map<String, Object> claims() {
        return GoogleTestKeys.claims("google-sub-1", "carolina@gmail.com", clock.instant());
    }

    @Test
    void aValidTokenSignsInAndCreatesTheAccountNamedByGoogle() {
        ApiResponse r = google(keys.token(claims()));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).isEqualTo("Carolina Mejía");
        assertThat(r.str("/email")).isEqualTo("carolina@gmail.com");
        assertThat(api.get("/session").status()).isEqualTo(200);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
        assertThat(db.fetchOne(PERSON).getDisplayNameChosen()).as("Google's own name may be public").isTrue();
    }

    @Test
    void theSameGoogleAccountIsTheSamePerson() {
        String first = google(keys.token(claims())).str("/id");
        String second = clients.newBrowser().post("/auth/google", "{\"credential\":\"" + keys.token(claims()) + "\"}").str("/id");
        assertThat(second).isEqualTo(first);
    }

    @Test
    void aFirstGoogleSignInLinksToTheAccountWithThatEmail() {
        String viaEmail = emailSignIn(api, "carolina@gmail.com").str("/id");
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
        var other = GoogleTestKeys.claims("google-sub-2", "carolina@gmail.com", clock.instant());
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
        assertThat(db.fetchOne(PERSON).getDisplayNameChosen()).as("an email-derived placeholder is never public").isFalse();
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

    /** Pins the ceiling: a new account from a browser that carries a session, on a session-cache miss. */
    @Test
    void aNewAccountFromASignedInBrowserIsExactlySevenStatements() {
        emailSignIn(api, "ana@correo.co");
        caches.orderedStream().filter(c -> !(c instanceof co.scuby.platform.flags.FeatureFlags)).forEach(co.scuby.platform.cache.ClearableCache::clear);
        ApiResponse r = google(keys.token(claims()));
        assertThat(r.status()).isEqualTo(200);
        // filter lookup, sub lookup, email lookup, person insert + select, old session DELETE, session insert
        assertThat(r.statements()).hasSize(7);
    }

    private ApiResponse signInWith(Map<String, Object> claims) {
        return clients.newBrowser().post("/auth/google", "{\"credential\":\"" + keys.token(claims) + "\"}");
    }

    // ---- outage is not a bad token
    @Test
    void googleKeysBeingUnreachableIsAServerErrorNotAnUnauthorized() {
        google(keys.token(claims()));                                              // warms the key cache
        keys.jwksDown(true);
        try {
            ApiResponse r = google(keys.tokenWithUnknownKeyId(claims()));          // unknown kid: refetch fails
            assertThat(r.status()).isEqualTo(500);
            assertThat(r.errorCode()).isEqualTo("server_error");
        } finally {
            keys.jwksDown(false);
        }
    }

    // ---- one account per email: authoritative emails link or create directly
    @Test
    void aGmailAddressLinksAnExistingEmailCodeAccount() {
        String id = emailSignIn(api, "carolina@gmail.com").str("/id");
        ApiResponse r = signInWith(claims());
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(id);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
    }

    @Test
    void aWorkspaceDomainMatchingHdLinksAnExistingAccount() {
        String id = emailSignIn(api, "carolina@empresa.co").str("/id");
        var c = GoogleTestKeys.claims("google-sub-1", "Carolina@Empresa.co", clock.instant());
        c.put("hd", "EMPRESA.co");
        ApiResponse r = signInWith(c);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(id);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
    }

    @Test
    void aWorkspaceAddressWithAMatchingHdCreatesTheAccountDirectly() {
        var c = GoogleTestKeys.claims("google-sub-1", "carolina@empresa.co", clock.instant());
        c.put("hd", "empresa.co");
        assertThat(signInWith(c).status()).isEqualTo(200);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
    }

    // ---- non-authoritative emails (decision 58): only an email-code session of the same address links them
    @Test
    void aNonAuthoritativeEmailWithoutASessionIsRefusedAndCreatesNothing() {
        ApiResponse r = signInWith(GoogleTestKeys.claims("google-sub-1", "carolina@correo.co", clock.instant()));
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
        assertThat(db.fetchCount(PERSON)).as("no account is created").isZero();
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.SESSION)).isZero();
    }

    @Test
    void anHdThatDoesNotMatchTheEmailDomainIsNotAuthoritative() {
        var c = GoogleTestKeys.claims("google-sub-1", "carolina@empresa.co", clock.instant());
        c.put("hd", "otra.co");
        assertThat(signInWith(c).errorCode()).isEqualTo("unauthorized");
        assertThat(db.fetchCount(PERSON)).isZero();
    }

    @Test
    void aNonAuthoritativeEmailWithoutASessionDoesNotLinkAnExistingAccount() {
        emailSignIn(api, "carolina@correo.co");
        ApiResponse r = signInWith(GoogleTestKeys.claims("google-sub-1", "carolina@correo.co", clock.instant()));
        assertThat(r.status()).isEqualTo(401);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isNull();
    }

    @Test
    void aNonAuthoritativeEmailWithASessionOfThatEmailLinksForeverAndThenGoogleAloneSignsIn() {
        String id = emailSignIn(api, "carolina@correo.co").str("/id");              // the browser now holds the session
        var c = GoogleTestKeys.claims("google-sub-1", "carolina@correo.co", clock.instant());
        ApiResponse linked = api.post("/auth/google", "{\"credential\":\"" + keys.token(c) + "\"}");
        assertThat(linked.status()).isEqualTo(200);
        assertThat(linked.str("/id")).isEqualTo(id);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");

        ApiResponse alone = signInWith(c);                                          // a fresh browser: no session
        assertThat(alone.status()).isEqualTo(200);
        assertThat(alone.str("/id")).isEqualTo(id);
        assertThat(db.fetchCount(PERSON)).isEqualTo(1);
    }

    @Test
    void aNonAuthoritativeEmailWithASessionOfAnotherEmailIsRefusedAndLinksNothing() {
        emailSignIn(api, "ana@correo.co");
        ApiResponse r = api.post("/auth/google", "{\"credential\":\"" + keys.token(
                GoogleTestKeys.claims("google-sub-1", "carolina@correo.co", clock.instant())) + "\"}");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
        assertThat(db.fetchCount(PERSON)).isEqualTo(1);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isNull();
        assertThat(api.get("/session").status()).as("the refused call leaves the session alone").isEqualTo(200);
    }

    @Test
    void aSessionOfAnotherEmailNeverLinksAnAuthoritativeAddressToIt() {
        emailSignIn(api, "ana@correo.co");
        ApiResponse r = api.post("/auth/google", "{\"credential\":\"" + keys.token(claims()) + "\"}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(db.fetchCount(PERSON)).as("carolina@gmail.com is its own account").isEqualTo(2);
        assertThat(db.selectFrom(PERSON).where(PERSON.EMAIL.eq("ana@correo.co")).fetchOne().getGoogleSub()).isNull();
    }

    @Test
    void anEmailCodeSignInKeepsAnExistingGoogleLinkAndItsSessions() {
        ApiClient google = clients.newBrowser();
        google.post("/auth/google", "{\"credential\":\"" + keys.token(claims()) + "\"}");
        assertThat(emailSignIn(clients.newBrowser(), "carolina@gmail.com").status()).isEqualTo(200);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
        assertThat(google.get("/session").status()).isEqualTo(200);
    }

    @Test
    void concurrentSignInsOfTheSameGoogleAccountOverAnEmailCodeAccountAreBothAccepted() throws Exception {
        for (int round = 0; round < 5; round++) {
            testDb.reset();
            String id = emailSignIn(clients.newBrowser(), "carolina@gmail.com").str("/id");
            var results = race(List.of("google-sub-1", "google-sub-1"));
            assertThat(results).extracting(ApiResponse::status).containsOnly(200);
            assertThat(results).extracting(r -> r.str("/id")).containsOnly(id);
        }
    }

    // ---- token shape
    @Test
    void anIssuedAtInTheFutureBeyondTheSkewIsRefused() {
        var c = claims();
        c.put("iat", java.util.Date.from(clock.instant().plusSeconds(600)));
        c.put("exp", java.util.Date.from(clock.instant().plusSeconds(4000)));
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anIssuedAtWithinTheSkewIsAccepted() {
        var c = claims();
        c.put("iat", java.util.Date.from(clock.instant().plusSeconds(30)));
        assertThat(google(keys.token(c)).status()).isEqualTo(200);
    }

    @Test
    void aTokenWithoutIssuedAtIsRefused() {
        var c = claims();
        c.remove("iat");
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void theBareAccountsGoogleComIssuerIsAccepted() {
        var c = claims();
        c.put("iss", "accounts.google.com");
        assertThat(google(keys.token(c)).status()).isEqualTo(200);
    }

    @Test
    void anAudienceListContainingOurClientIsAcceptedAndOneWithoutItRefused() {
        var ok = claims();
        ok.put("aud", List.of("other", GoogleTestKeys.CLIENT_ID));
        assertThat(google(keys.token(ok)).status()).isEqualTo(200);
        var no = claims();
        no.put("aud", List.of("other", "another"));
        assertThat(google(keys.token(no)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anHs256TokenAndAnUnsignedTokenAreRefused() throws Exception {
        var set = new com.nimbusds.jwt.JWTClaimsSet.Builder().issuer("https://accounts.google.com").audience(GoogleTestKeys.CLIENT_ID)
                .subject("google-sub-1").claim("email", "carolina@gmail.com").claim("email_verified", true)
                .issueTime(java.util.Date.from(clock.instant())).expirationTime(java.util.Date.from(clock.instant().plusSeconds(3600))).build();
        var hs = new com.nimbusds.jwt.SignedJWT(new com.nimbusds.jose.JWSHeader.Builder(com.nimbusds.jose.JWSAlgorithm.HS256).keyID("test").build(), set);
        hs.sign(new com.nimbusds.jose.crypto.MACSigner(new byte[32]));
        assertThat(google(hs.serialize()).errorCode()).isEqualTo("unauthorized");
        assertThat(google(new com.nimbusds.jwt.PlainJWT(set).serialize()).errorCode()).isEqualTo("unauthorized");
    }

    // ---- name
    @Test
    void controlAndFormatCharactersAreStrippedFromTheGoogleName() {
        var c = claims();
        c.put("name", "Caro\u200Blina\u202E Mej\u0007ía");
        assertThat(google(keys.token(c)).str("/display_name")).isEqualTo("Carolina Mejía");
    }

    @Test
    void aNameOfOnlyInvisibleCharactersFallsBackToTheEmail() {
        var c = claims();
        c.put("name", "\u200B\u202E");
        assertThat(google(keys.token(c)).str("/display_name")).isEqualTo("Carolina");
        assertThat(db.fetchOne(PERSON).getDisplayNameChosen()).as("an email-derived placeholder is never public").isFalse();
    }

    private List<ApiResponse> race(List<String> subs) throws Exception {
        return race(subs, "carolina@gmail.com");
    }

    private List<ApiResponse> race(List<String> subs, String email) throws Exception {
        var pool = Executors.newFixedThreadPool(subs.size());
        try {
            var barrier = new CyclicBarrier(subs.size());
            List<Future<ApiResponse>> futures = subs.stream().map(sub -> {
                String token = keys.token(GoogleTestKeys.claims(sub, email, clock.instant()));
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
