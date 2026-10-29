package co.scuby.support;

import jakarta.servlet.http.HttpServletResponse;
import org.jooq.DSLContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import co.scuby.platform.security.SecurityRules;

import java.io.IOException;
import java.util.Map;

/**
 * Test-only routes (this class lives in src/test, so production never has them) that let the harness
 * self-tests prove its guardrails fail: statement counts, 204 answers, and a request a filter refuses.
 * None is in the contract; self-tests call them through ApiClient.callChecked with a stand-in contract path.
 */
@RestController
class ProbeController {

    private final DSLContext db;

    ProbeController(DSLContext db) {
        this.db = db;
    }

    @GetMapping("/harness-probe/ok")
    Map<String, Object> ok() {
        return Map.of("ok", true);
    }

    /** Runs n jOOQ statements, then answers 204. */
    @PostMapping("/harness-probe/statements")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void statements(@RequestParam int n) {
        for (int i = 0; i < n; i++) db.selectOne().fetch();
    }

    @PostMapping("/harness-probe/no-content")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void noContent() {}

    /** A 204 that wrongly carries a body. */
    @PostMapping("/harness-probe/no-content-with-body")
    void noContentWithBody(HttpServletResponse response) throws IOException {
        response.setStatus(204);
        response.getWriter().write("oops");
    }

    /** Behind an authentication rule: an anonymous call is answered by the filter chain, the handler never runs. */
    @GetMapping("/harness-probe/secured")
    Map<String, Object> secured() {
        return Map.of("ok", true);
    }

    @Configuration(proxyBeanMethods = false)
    static class ProbeSecurity {
        @Bean
        SecurityRules probeSecurityRules() {
            return rules -> rules.requestMatchers("/harness-probe/secured").authenticated();
        }
    }
}
