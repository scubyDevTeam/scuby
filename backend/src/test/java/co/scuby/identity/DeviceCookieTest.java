package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

@IntegrationTest
@Import(DeviceCookieTest.Probe.class)
class DeviceCookieTest {

    @TestConfiguration
    @RestController
    static class Probe {
        @GetMapping("/probe/caller")
        Map<String, Object> caller(Caller caller) {
            return Map.of("device", caller.deviceHash(), "signed_in", caller.signedIn());
        }

        @PostMapping("/probe/caller")
        Map<String, Object> callerPost(Caller caller) { return caller(caller); }

        @GetMapping("/probe/account")
        String account(Account account) { return account.personId().toString(); }
    }

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired MockMvc mvc;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void aRequestCarryingTheCookieTwiceIsTreatedAsHavingNone() throws Exception {
        // MockMvc directly: ApiClient's cookie jar holds one cookie per name, so it cannot send a duplicate.
        // A sibling subdomain planting `device` for the parent domain makes the browser send two (cookie tossing).
        String planted = "A".repeat(43);
        String real = "B".repeat(43);
        MockHttpServletResponse r = mvc.perform(get("/probe/caller")
                        .cookie(new Cookie("device", planted), new Cookie("device", real)))
                .andReturn().getResponse();
        String issued = r.getHeaders(HttpHeaders.SET_COOKIE).stream().filter(c -> c.startsWith("device=")).findFirst().orElseThrow();
        assertThat(issued).doesNotStartWith("device=" + planted).doesNotStartWith("device=" + real);
        assertThat(r.getContentAsString()).doesNotContain(Hashing.sha256Hex(planted)).doesNotContain(Hashing.sha256Hex(real));
    }

    @Test
    void aRequestWithoutTheCookieGetsOne() {
        ApiResponse r = clients.newBrowser().raw(HttpMethod.GET, "/probe/caller", null);
        String cookie = r.setCookies().stream().filter(c -> c.startsWith("device=")).findFirst().orElseThrow();
        assertThat(cookie).matches("^device=[A-Za-z0-9_-]{43};.*")
                .contains("Path=/").contains("Max-Age=31536000").contains("Secure").contains("HttpOnly").contains("SameSite=Lax");
        assertThat(r.str("/device")).matches("^[0-9a-f]{64}$");
        assertThat(r.json().get("signed_in").asBoolean()).isFalse();
    }

    @Test
    void theSameBrowserIsTheSameDeviceAndAReadDoesNotRenew() {
        ApiClient browser = clients.newBrowser();
        String first = browser.raw(HttpMethod.GET, "/probe/caller", null).str("/device");
        ApiResponse again = browser.raw(HttpMethod.GET, "/probe/caller", null);
        assertThat(again.str("/device")).isEqualTo(first);
        assertThat(again.setCookies()).noneMatch(c -> c.startsWith("device="));
    }

    @Test
    void anUnsafeRequestRenewsTheCookie() {
        ApiClient browser = clients.newBrowser();
        browser.raw(HttpMethod.GET, "/probe/caller", null);
        String value = browser.cookie("device").orElseThrow();
        ApiResponse post = browser.raw(HttpMethod.POST, "/probe/caller", null);
        assertThat(post.setCookies()).anyMatch(c -> c.startsWith("device=" + value + ";"));
    }

    @Test
    void aMalformedCookieIsReplaced() {
        ApiClient browser = clients.newBrowser();
        browser.setCookie("device", "not-a-token");
        ApiResponse r = browser.raw(HttpMethod.GET, "/probe/caller", null);
        assertThat(r.setCookies()).anyMatch(c -> c.startsWith("device=") && !c.startsWith("device=not-a-token"));
    }

    @Test
    void differentBrowsersAreDifferentDevices() {
        String a = clients.newBrowser().raw(HttpMethod.GET, "/probe/caller", null).str("/device");
        String b = clients.newBrowser().raw(HttpMethod.GET, "/probe/caller", null).str("/device");
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    void aSecurityRejectedRequestStillGetsTheCookie() {
        ApiResponse r = clients.newBrowser().raw(HttpMethod.GET, "/probe/account", null);
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.setCookies()).anyMatch(c -> c.startsWith("device="));
    }

    @Test
    void aCorsPreflightGetsNoCookie() {
        ApiResponse r = clients.newBrowser()
                .header("Origin", "http://localhost:4173")
                .header("Access-Control-Request-Method", "POST")
                .raw(HttpMethod.OPTIONS, "/probe/caller", null);
        assertThat(r.setCookies()).noneMatch(c -> c.startsWith("device="));
    }

    @Test
    void anAccountParameterWithoutASessionIsUnauthorized() {
        ApiResponse r = clients.newBrowser().raw(HttpMethod.GET, "/probe/account", null);
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
    }
}
