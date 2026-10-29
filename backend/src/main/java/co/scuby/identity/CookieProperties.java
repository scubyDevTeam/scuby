package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.cookies.secure: true everywhere (browsers accept Secure cookies from http://localhost). */
@ConfigurationProperties("scuby.cookies")
record CookieProperties(boolean secure) {}
