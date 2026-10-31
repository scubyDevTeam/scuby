package co.scuby.platform.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * scuby.web.*: who may call the API from a browser.
 *
 * @param allowedOrigins origins allowed by CORS and by the Origin check (the web client's origins)
 */
@ConfigurationProperties("scuby.web")
public record WebProperties(List<String> allowedOrigins) {
    public WebProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
    }
}
