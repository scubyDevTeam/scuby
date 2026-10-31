package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** scuby.sessions.*: cache size (0 disables it), cache TTL, absolute lifetime in months. */
@ConfigurationProperties("scuby.sessions")
record SessionProperties(int cacheSize, Duration cacheTtl, int lifetimeMonths) {}
