package co.scuby.identity;

import co.scuby.platform.config.Prod;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.Resource;
import com.nimbusds.jose.util.ResourceRetriever;
import org.springframework.core.env.Environment;
import org.springframework.web.client.RestClientException;
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
import org.springframework.web.client.RestOperations;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Objects;
import java.util.Set;

@Configuration(proxyBeanMethods = false)
class GoogleIdTokenConfiguration {

    private static final long SKEW_SECONDS = 60;
    static final Duration KEY_REFETCH_MIN_INTERVAL = Duration.ofSeconds(30);
    private static final Duration CACHE_TTL = Duration.ofMinutes(5);
    private static final Duration CACHE_REFRESH_TIMEOUT = Duration.ofSeconds(15);
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
        return decoder(google.jwkSetUri(), new RestTemplate(http), google.clientId(), clock, KEY_REFETCH_MIN_INTERVAL);
    }

    /**
     * The one decoder recipe (RS256 only, our validators); tests reuse it with their own key fetcher. Keys are
     * cached (5 min, one refresh at a time) and the key set is refetched at most once per `minRefetchInterval`:
     * a token naming an unknown `kid` forces a refetch, and /auth/google is open to anyone, so without the
     * limit each such request would call Google. Past the limit the decode fails with RateLimitReachedException
     * (see GoogleIdTokens: the caller's 401, not our outage).
     */
    static NimbusJwtDecoder decoder(String jwkSetUri, RestOperations rest, String clientId, Clock clock, Duration minRefetchInterval) {
        URL url;
        try {
            url = URI.create(jwkSetUri).toURL();
        } catch (MalformedURLException e) {
            throw new IllegalArgumentException("invalid scuby.auth.google.jwk-set-uri: " + jwkSetUri, e);
        }
        ResourceRetriever retriever = u -> {
            try {
                String body = rest.getForObject(u.toURI(), String.class);
                if (body == null) throw new IOException("empty JWKS response");
                return new Resource(body, "application/json");
            } catch (RestClientException | URISyntaxException e) {
                throw new IOException("could not fetch Google's JWKS: " + e.getMessage(), e);
            }
        };
        JWKSource<SecurityContext> source = JWKSourceBuilder.<SecurityContext>create(url, retriever)
                .cache(CACHE_TTL.toMillis(), CACHE_REFRESH_TIMEOUT.toMillis())
                .rateLimited(minRefetchInterval.toMillis())
                .build();
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSource(source)
                                                   .jwsAlgorithm(SignatureAlgorithm.RS256)
                                                   .build();
        decoder.setJwtValidator(validator(clientId, clock));
        return decoder;
    }

    /**
     * Expiry (60 s skew) on our clock, `exp` present and `iat` present and not in the future beyond the skew
     * (JwtTimestampValidator skips an absent one), Google as issuer, our client ID in the audience.
     */
    static OAuth2TokenValidator<Jwt> validator(String clientId, Clock clock) {
        JwtTimestampValidator time = new JwtTimestampValidator(Duration.ofSeconds(SKEW_SECONDS));
        time.setClock(clock);
        OAuth2TokenValidator<Jwt> hasExpiry = new JwtClaimValidator<Instant>(JwtClaimNames.EXP, Objects::nonNull);
        OAuth2TokenValidator<Jwt> hasIssuedAt = new JwtClaimValidator<Instant>(JwtClaimNames.IAT,
                iat -> iat != null && !iat.isAfter(clock.instant().plusSeconds(SKEW_SECONDS)));
        OAuth2TokenValidator<Jwt> issuer = new JwtClaimValidator<Object>(JwtClaimNames.ISS,
                iss -> iss != null && ISSUERS.contains(iss.toString()));
        OAuth2TokenValidator<Jwt> audience = new JwtClaimValidator<Object>(JwtClaimNames.AUD,
                aud -> aud instanceof Collection<?> c ? c.contains(clientId) : clientId.equals(aud));
        return new DelegatingOAuth2TokenValidator<>(time, hasExpiry, hasIssuedAt, issuer, audience);
    }
}
