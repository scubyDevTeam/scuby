package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.auth.google.*: our OAuth client ID (the token's audience) and Google's key set. */
@ConfigurationProperties("scuby.auth.google")
record GoogleProperties(String clientId, String jwkSetUri) {}
