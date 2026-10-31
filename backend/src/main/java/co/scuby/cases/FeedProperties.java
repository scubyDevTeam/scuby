package co.scuby.cases;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.feed.*: what counts as near, and the cap while the contract has no paging. */
@ConfigurationProperties("scuby.feed")
record FeedProperties(double nearRadiusM, int maxItems) {}
