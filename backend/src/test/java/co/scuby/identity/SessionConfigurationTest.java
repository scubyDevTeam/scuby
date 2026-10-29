package co.scuby.identity;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class SessionConfigurationTest {

    @Test
    void cacheSizeZeroDisablesTheCache() {
        var config = new SessionConfiguration();
        assertThat(config.sessionLookup(null, Clock.systemUTC(), new SessionProperties(0, Duration.ofSeconds(60), 12)))
                .isInstanceOf(DbSessionLookup.class);
        assertThat(config.sessionLookup(null, Clock.systemUTC(), new SessionProperties(10_000, Duration.ofSeconds(60), 12)))
                .isInstanceOf(CachingSessionLookup.class);
    }
}
