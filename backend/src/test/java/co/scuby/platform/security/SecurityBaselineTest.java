package co.scuby.platform.security;

import co.scuby.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, SecurityBaselineTest.Probe.class})
class SecurityBaselineTest {

    @TestConfiguration
    @RestController
    static class Probe {
        @GetMapping("/probe/open") String open() { return "open"; }
        @PostMapping("/probe/open") String openPost() { return "posted"; }
        @GetMapping("/probe/secured") String secured() { return "secret"; }

        @Bean
        SecurityRules probeRules() {
            return rules -> rules.requestMatchers("/probe/secured").authenticated();
        }

        /** Fails like a session lookup with the database down, only when asked to. */
        @Bean
        RequestAuthenticator failingProbeAuthenticator() {
            return request -> {
                if (request.getHeader("X-Probe-Fail") != null) throw new IllegalStateException("database down");
                return Optional.empty();
            };
        }
    }

    @Autowired MockMvc mvc;

    @Test
    void routesArePublicUnlessAFeatureSaysOtherwise() throws Exception {
        mvc.perform(get("/probe/open")).andExpect(status().isOk());
    }

    @Test
    void anAuthenticatedRouteWithoutASessionIsUnauthorizedInTheEnvelope() throws Exception {
        mvc.perform(get("/probe/secured"))
           .andExpect(status().isUnauthorized())
           .andExpect(jsonPath("$.error.code").value("unauthorized"))
           .andExpect(jsonPath("$.error.message").value("unauthorized"));
    }

    @Test
    void anUnsafeRequestFromAForeignOriginIsForbidden() throws Exception {
        mvc.perform(post("/probe/open").header("Origin", "https://evil.example"))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.error.code").value("forbidden"));
    }

    @Test
    void anUnsafeCrossSiteRequestWithoutOriginIsForbidden() throws Exception {
        mvc.perform(post("/probe/open").header("Sec-Fetch-Site", "cross-site"))
           .andExpect(status().isForbidden());
    }

    @Test
    void anUnsafeRequestFromTheClientsOriginPasses() throws Exception {
        mvc.perform(post("/probe/open").header("Origin", "http://localhost:4173"))
           .andExpect(status().isOk());
    }

    @Test
    void anUnsafeRequestWithoutBrowserHeadersPasses() throws Exception {
        // curl, server-to-server, MockMvc: cannot carry a victim's cookies, so not a CSRF vector.
        mvc.perform(post("/probe/open")).andExpect(status().isOk());
    }

    @Test
    void corsPreflightFromTheClientAllowsCredentials() throws Exception {
        mvc.perform(options("/probe/open")
                   .header("Origin", "http://localhost:4173")
                   .header("Access-Control-Request-Method", "POST")
                   .header("Access-Control-Request-Headers", "content-type,accept-language"))
           .andExpect(status().isOk())
           .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:4173"))
           .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
    }

    @Test
    void securityHeadersAreSet() throws Exception {
        mvc.perform(get("/probe/open"))
           .andExpect(header().string("X-Content-Type-Options", "nosniff"))
           // Kept on purpose (Task 1 · Response caching): no shared cache stores a per-viewer answer.
           .andExpect(header().string("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate"));
    }

    @Test
    void aForeignOriginGetIsRefusedByCorsInPlainText() throws Exception {
        // Documented limitation: CorsFilter answers before any envelope can be written.
        mvc.perform(get("/probe/open").header("Origin", "https://evil.example"))
           .andExpect(status().isForbidden());
    }

    @Test
    void anAuthenticatorFailureIsAServerErrorInTheEnvelope() throws Exception {
        mvc.perform(get("/probe/open").header("X-Probe-Fail", "1"))
           .andExpect(status().isInternalServerError())
           .andExpect(jsonPath("$.error.code").value("server_error"))
           .andExpect(jsonPath("$.error.message").value("server_error"));
    }
}
