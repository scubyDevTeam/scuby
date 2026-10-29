package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.ConnectionSampler;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.StatementRecorder;
import co.scuby.support.TestDb;
import jakarta.servlet.http.Cookie;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.SESSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

@IntegrationTest
class SessionTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired ConnectionSampler sampler;
    @Autowired StatementRecorder recorder;
    @Autowired MockMvc mvc;
    @Autowired SessionLookup lookup;
    @Autowired SessionStore store;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        ApiResponse r = api.get("/session");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aSignedInPersonGetsTheirUser() {
        UUID id = accounts.signIn(api, "ana.gomez@correo.co");
        ApiResponse r = api.get("/session");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(id.toString());
        assertThat(r.str("/email")).isEqualTo("ana.gomez@correo.co");
        assertThat(r.isNull("/phone")).isTrue();
    }

    @Test
    void aSessionReadIssuesNoInsertOrUpdateAndReturnsItsConnection() {
        accounts.signIn(api, "ana.gomez@correo.co");
        ApiResponse r = api.get("/session");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.statements()).noneMatch(s -> s.trim().toLowerCase().matches("^(insert|update|delete|merge).*"));
        // The filter's lookup ran outside any transaction …
        assertThat(recorder.autoCommits()).as("statements: %s", r.statements()).first().isEqualTo(true);
        // … and its connection was back in the pool before the controller started (sampled *during* the request).
        assertThat(sampler.activeWhenTheHandlerStarted()).hasValue(0);
        // Stateless: no servlet session, no JSESSIONID.
        assertThat(r.httpSessionCreated()).isFalse();
        assertThat(r.setCookies()).noneMatch(c -> c.startsWith("JSESSIONID"));
    }

    @Test
    void anAnonymousRequestCreatesNoServletSession() {
        ApiResponse r = api.get("/session");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.httpSessionCreated()).isFalse();
        assertThat(r.setCookies()).noneMatch(c -> c.startsWith("JSESSIONID"));
    }

    @Test
    void theCookieLastsExactlyAsLongAsTheSession() {
        // Seconds from START to START + 12 calendar months (365 here: 2026-10-14 → 2027-10-14).
        long seconds = Duration.between(MutableClock.START,
                MutableClock.START.atOffset(ZoneOffset.UTC).plusMonths(12).toInstant()).toSeconds();
        UUID id = accounts.person("ana.gomez@correo.co");
        NewSession session = store.create(id);
        assertThat(session.expiresAt()).isEqualTo(MutableClock.START.atOffset(ZoneOffset.UTC).plusMonths(12).toInstant());
        var response = new org.springframework.mock.web.MockHttpServletResponse();
        new SessionCookies(new CookieProperties(true), clock).issue(response, session);
        assertThat(response.getHeader("Set-Cookie")).startsWith("__Host-session=" + session.token() + ";")
                .contains("Max-Age=" + seconds).contains("Secure").contains("Path=/").doesNotContain("Domain");
    }

    @Test
    void aRequestCarryingTheSessionCookieTwiceIsSignedOut() throws Exception {
        accounts.signIn(api, "ana.gomez@correo.co");
        String real = api.cookie("__Host-session").orElseThrow();
        int status = mvc.perform(get("/session")
                        .cookie(new Cookie("__Host-session", "A".repeat(43)), new Cookie("__Host-session", real)))
                .andReturn().getResponse().getStatus();
        assertThat(status).isEqualTo(401);
    }

    @Test
    void theLookupIsCachedSoTheSecondReadSkipsIt() {
        accounts.signIn(api, "ana.gomez@correo.co");
        int first = api.get("/session").statements().size();
        int second = api.get("/session").statements().size();
        assertThat(second).isEqualTo(first - 1);
    }

    @Test
    void sessionsExpireTwelveMonthsAfterSignInWhateverTheUse() {
        accounts.signIn(api, "ana.gomez@correo.co");
        clock.advance(Duration.ofDays(200));
        assertThat(api.get("/session").status()).isEqualTo(200);   // use does not slide the expiry
        clock.set(MutableClock.START.atOffset(ZoneOffset.UTC).plusMonths(12).toInstant());
        assertThat(api.get("/session").status()).isEqualTo(401);
    }

    @Test
    void signOutEndsTheSessionAndClearsTheCookie() {
        accounts.signIn(api, "ana.gomez@correo.co");
        String token = api.cookie("__Host-session").orElseThrow();
        api.get("/session");                                      // now cached
        ApiResponse out = api.post("/auth/sign-out", null);
        assertThat(out.status()).isEqualTo(204);
        assertThat(out.setCookies()).anyMatch(c -> c.startsWith("__Host-session=;") && c.contains("Max-Age=0"));
        assertThat(db.fetchCount(SESSION, SESSION.TOKEN_HASH.eq(Hashing.sha256Hex(token)))).isZero();
        assertThat(lookup.find(Hashing.sha256Hex(token))).isEmpty();   // evicted, not just deleted
        ApiClient stolen = clients.newBrowser();
        stolen.setCookie("__Host-session", token);
        assertThat(stolen.get("/session").status()).isEqualTo(401);
    }

    @Test
    void signOutOnTheUncachedPathStaysUnderItsCeiling() {
        accounts.signIn(api, "ana.gomez@correo.co");
        assertThat(api.post("/auth/sign-out", null).status()).isEqualTo(204);   // lookup + DELETE, cold
    }

    @Test
    void signOutWithoutASessionIs204() {
        assertThat(api.post("/auth/sign-out", null).status()).isEqualTo(204);
    }

    @Test
    void aGarbageCookieIsJustNobody() {
        api.setCookie("__Host-session", "garbage");
        assertThat(api.get("/session").status()).isEqualTo(401);
    }

    @Test
    void purgeRemovesOnlyExpiredSessions() {
        accounts.signIn(api, "old@correo.co");
        clock.advance(Duration.ofDays(400));
        accounts.signIn(clients.newBrowser(), "new@correo.co");
        assertThat(store.purgeExpired()).isEqualTo(1);
        assertThat(db.fetchCount(SESSION)).isEqualTo(1);
    }
}
