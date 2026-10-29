package co.scuby.platform.time;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.Duration;

/** The only source of "now" (docs/eng/backend.md · Code structure): tests replace it with a MutableClock. */
@Configuration(proxyBeanMethods = false)
public class TimeConfiguration {

    /** Ticks in microseconds, the precision Postgres stores, so a written instant reads back equal. */
    @Bean
    Clock clock() {
        return Clock.tick(Clock.systemUTC(), Duration.ofNanos(1_000));
    }
}
