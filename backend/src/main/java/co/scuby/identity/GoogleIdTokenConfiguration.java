package co.scuby.identity;

import co.scuby.platform.config.Prod;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.web.client.RestTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Objects;
import java.util.Set;

@Configuration(proxyBeanMethods = false)
class GoogleIdTokenConfiguration {

    static final String DEFAULT_CLIENT_ID = "local-google-client-id";
    private static final Set<String> ISSUERS = Set.of("https://accounts.google.com", "accounts.google.com");

    /**
     * Keys are fetched from Google lazily, at the first sign-in (no network at start-up), with timeouts
     * so a slow Google never hangs sign-in requests.
     */
    @Bean
    JwtDecoder googleIdTokenDecoder(GoogleProperties google, Clock clock, Environment env) {
        Prod.requireDeployed(env, google.clientId() != null && !DEFAULT_CLIENT_ID.equals(google.clientId()),
                "scuby.auth.google.client-id (env SCUBY_AUTH_GOOGLE_CLIENT_ID: the web client's Google OAuth client ID)");
        SimpleClientHttpRequestFactory http = new SimpleClientHttpRequestFactory();
        http.setConnectTimeout(Duration.ofSeconds(2));
        http.setReadTimeout(Duration.ofSeconds(3));
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(google.jwkSetUri())
                                                   .jwsAlgorithm(SignatureAlgorithm.RS256)
                                                   .restOperations(new RestTemplate(http))
                                                   .build();
        decoder.setJwtValidator(validator(google.clientId(), clock));
        return decoder;
    }

    /**
     * Expiry (60 s skew) on our clock, `exp` and `iat` present (JwtTimestampValidator skips an absent
     * one), Google as issuer, our client ID in the audience.
     */
    static OAuth2TokenValidator<Jwt> validator(String clientId, Clock clock) {
        JwtTimestampValidator time = new JwtTimestampValidator(Duration.ofSeconds(60));
        time.setClock(clock);
        OAuth2TokenValidator<Jwt> hasExpiry = new JwtClaimValidator<Instant>(JwtClaimNames.EXP, Objects::nonNull);
        OAuth2TokenValidator<Jwt> hasIssuedAt = new JwtClaimValidator<Instant>(JwtClaimNames.IAT, Objects::nonNull);
        OAuth2TokenValidator<Jwt> issuer = new JwtClaimValidator<Object>(JwtClaimNames.ISS,
                iss -> iss != null && ISSUERS.contains(iss.toString()));
        OAuth2TokenValidator<Jwt> audience = new JwtClaimValidator<Object>(JwtClaimNames.AUD,
                aud -> aud instanceof Collection<?> c ? c.contains(clientId) : clientId.equals(aud));
        return new DelegatingOAuth2TokenValidator<>(time, hasExpiry, hasIssuedAt, issuer, audience);
    }
}
