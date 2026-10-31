package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * scuby.auth.*: the key of the code HMAC.
 * The nested test-bypass and google blocks bind to TestBypass and GoogleProperties.
 */
@ConfigurationProperties("scuby.auth")
record AuthProperties(String codeHashKey) {}
