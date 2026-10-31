package co.scuby.cases;

import co.scuby.platform.security.SecurityRules;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.stereotype.Component;

/** cases' `session` endpoints (openapi.json security: session). Case reads, the feed and sightings are public. */
@Component
class CasesSecurityRules implements SecurityRules {
    @Override
    public void authorize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry rules) {
        rules.requestMatchers(HttpMethod.POST, "/lost-cases").authenticated();
    }
}
