package co.scuby.identity;

import co.scuby.platform.security.SecurityRules;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.stereotype.Component;

/** identity's `session` endpoints (openapi.json security: session). */
@Component
class IdentitySecurityRules implements SecurityRules {
    @Override
    public void authorize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry rules) {
        rules.requestMatchers(HttpMethod.GET, "/session").authenticated()
             .requestMatchers("/me/**").authenticated();
    }
}
