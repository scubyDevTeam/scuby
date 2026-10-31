package co.scuby.platform.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * scuby.web.*: who may call the API from a browser.
 *
 * @param allowedOrigins     origins allowed by CORS and by the Origin check (the web client's origins)
 * @param originSecretHeader the header CloudFront adds with the origin secret
 * @param originSecret       its value; required under prod (OriginSecretGuard)
 */
@ConfigurationProperties("scuby.web")
public record WebProperties(List<String> allowedOrigins, String originSecretHeader, String originSecret) {
    public WebProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
        originSecret = originSecret == null ? "" : originSecret;
    }
}
