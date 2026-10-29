package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * scuby.cookies.secure: true everywhere. Secure cookies over http://localhost were checked in Chrome and
 * Firefox; older Safari may not accept them, so local development there needs scuby.cookies.secure=false.
 */
@ConfigurationProperties("scuby.cookies")
record CookieProperties(boolean secure) {}
