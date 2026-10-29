package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * scuby.auth.*: the key of the code HMAC and the email-start caps per device and per IP (rolling 24 h).
 * The nested test-bypass and google blocks bind to TestBypass and GoogleProperties.
 */
@ConfigurationProperties("scuby.auth")
record AuthProperties(String codeHashKey, int emailMaxPerDevice, int emailMaxPerIp) {}
