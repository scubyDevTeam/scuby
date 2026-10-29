package co.scuby.platform.security;

import co.scuby.platform.web.ErrorCode;
import co.scuby.platform.web.ErrorEnvelopeWriter;
import co.scuby.platform.config.Prod;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.time.Duration;
import java.util.List;

/**
 * The one filter chain (docs/eng/backend.md · Security). Stateless: the session is our own cookie,
 * resolved by a RequestAuthenticator; Spring's HTTP session, form login, basic auth and logout are off.
 * CORS: `Customizer.withDefaults()` picks the bean named corsConfigurationSource — injecting a
 * CorsConfigurationSource by type is ambiguous (Spring MVC's HandlerMappingIntrospector is one too).
 */
@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {

    @Bean
    SecurityFilterChain apiFilterChain(HttpSecurity http,
                                       ObjectProvider<SecurityRules> rules,
                                       ObjectProvider<RequestAuthenticator> authenticators,
                                       ErrorEnvelopeWriter errors,
                                       WebProperties web) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .httpBasic(AbstractHttpConfigurer::disable)
            .formLogin(AbstractHttpConfigurer::disable)
            .logout(AbstractHttpConfigurer::disable)
            .requestCache(AbstractHttpConfigurer::disable)
            .exceptionHandling(e -> e
                    .authenticationEntryPoint((req, res, ex) -> errors.write(res, ErrorCode.UNAUTHORIZED))
                    .accessDeniedHandler((req, res, ex) -> errors.write(res, ErrorCode.FORBIDDEN)))
            // Before CorsFilter: a refused unsafe request gets the envelope, not CORS's plain-text 403.
            .addFilterBefore(new OriginCheckFilter(web.allowedOrigins(), errors), CorsFilter.class)
            .addFilterBefore(new RequestAuthenticationFilter(authenticators.orderedStream().toList(), errors),
                    AnonymousAuthenticationFilter.class)
            .authorizeHttpRequests(a -> {
                rules.orderedStream().forEach(r -> r.authorize(a));
                a.anyRequest().permitAll();
            });
        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(WebProperties web, Environment env) {
        Prod.requireDeployed(env, !web.allowedOrigins().isEmpty(),
                "scuby.web.allowed-origins (env SCUBY_WEB_ALLOWED_ORIGINS: the web client's origins, comma-separated)");
        Prod.refuse(env, web.originSecret().isBlank(),
                "scuby.web.origin-secret is blank (env SCUBY_WEB_ORIGIN_SECRET: CloudFront's origin secret)");
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(web.allowedOrigins());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        config.setMaxAge(Duration.ofHours(1));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
