package co.scuby.cases;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** scuby.feed.*: what counts as near, and the cap while the contract has no paging. */
@Validated
@ConfigurationProperties("scuby.feed")
record FeedProperties(@Positive(message = "scuby.feed.near-radius-m must be set and positive") double nearRadiusM,
                      @Min(value = 1, message = "scuby.feed.max-items must be set and at least 1") int maxItems) {}
