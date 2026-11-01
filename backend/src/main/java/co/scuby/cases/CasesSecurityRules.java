package co.scuby.cases;

import co.scuby.platform.security.SecurityRules;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.stereotype.Component;

/** cases' `session` endpoints (openapi.json security: session), each with its method. Case reads, the feed, «Lo vi» and a reporter's correction and delete are public. */
@Component
class CasesSecurityRules implements SecurityRules {
    @Override
    public void authorize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry rules) {
        rules.requestMatchers(HttpMethod.POST, "/lost-cases").authenticated();
        rules.requestMatchers(HttpMethod.GET, "/me/cases").authenticated();
        rules.requestMatchers(HttpMethod.POST, "/cases/*/reunite").authenticated();
        rules.requestMatchers(HttpMethod.POST, "/cases/*/cancel").authenticated();
        rules.requestMatchers(HttpMethod.POST, "/cases/*/reopen").authenticated();
        rules.requestMatchers(HttpMethod.PATCH, "/lost-cases/*").authenticated();
        rules.requestMatchers(HttpMethod.PATCH, "/cases/*").authenticated();
    }
}
