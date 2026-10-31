package co.scuby.platform.security;

import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;

/**
 * Each feature declares its own route rules as a bean (no central file every feature edits).
 * A route no rule matches is public; endpoints marked `session` in the contract must be declared here.
 */
@FunctionalInterface
public interface SecurityRules {
    void authorize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry rules);
}
