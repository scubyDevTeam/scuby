package co.scuby.platform.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * scuby.web.*: who may call the API from a browser, and how the client's IP is trusted.
 *
 * @param allowedOrigins     origins allowed by CORS and by the Origin check (the web client's origins)
 * @param originSecretHeader the header CloudFront adds with the origin secret
 * @param originSecret       its value; blank = never trust CloudFront-Viewer-Address (local)
 * @param ipHashKey          HMAC key for stored IP hashes; required (not blank, at least 32 characters, not the local default) in every deployed profile
 */
@ConfigurationProperties("scuby.web")
public record WebProperties(List<String> allowedOrigins, String originSecretHeader, String originSecret, String ipHashKey) {
    public WebProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
        originSecret = originSecret == null ? "" : originSecret;
    }
}
