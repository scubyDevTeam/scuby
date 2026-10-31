package co.scuby.platform.flags;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** scuby.flags.cache-ttl: how long a flip may take to be seen (docs/eng/feature-flags.md: ~30 s). */
@ConfigurationProperties("scuby.flags")
public record FlagProperties(Duration cacheTtl) {
    public FlagProperties {
        if (cacheTtl == null) cacheTtl = Duration.ofSeconds(30);
    }
}
