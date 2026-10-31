package co.scuby.cases;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.validation.autoconfigure.ValidationAutoConfiguration;

import static org.assertj.core.api.Assertions.assertThat;

/** A dropped limit would bind to 0: every «Lo vi» rate_limited, an empty feed. Start-up must fail naming the key instead. */
class LimitPropertiesValidationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
            .withUserConfiguration(Enabled.class);

    @EnableConfigurationProperties({SightingProperties.class, FeedProperties.class})
    static class Enabled {}

    private static final String[] COMPLETE = {
            "scuby.sightings.per-case=5", "scuby.sightings.per-reporter=20", "scuby.sightings.per-case-per-ip=20", "scuby.sightings.per-ip=80",
            "scuby.feed.near-radius-m=25000", "scuby.feed.max-items=100"};

    @Test
    void aCompleteConfigurationBinds() {
        runner.withPropertyValues(COMPLETE).run(ctx -> assertThat(ctx).hasNotFailed());
    }

    @Test
    void eachMissingOrZeroValueFailsStartUpNamingItsKey() {
        for (String full : COMPLETE) {
            String key = full.substring(0, full.indexOf('='));
            String[] without = java.util.Arrays.stream(COMPLETE).filter(p -> !p.equals(full)).toArray(String[]::new);
            runner.withPropertyValues(without).run(ctx -> {
                assertThat(ctx).as("without %s", key).hasFailed();
                assertThat(messages(ctx.getStartupFailure())).contains(key);
            });
            String[] zero = java.util.Arrays.stream(COMPLETE).map(p -> p.equals(full) ? key + "=0" : p).toArray(String[]::new);
            runner.withPropertyValues(zero).run(ctx -> assertThat(ctx).as("%s=0", key).hasFailed());
        }
    }

    private static String messages(Throwable failure) {
        StringBuilder sb = new StringBuilder();
        for (Throwable t = failure; t != null; t = t.getCause()) sb.append(t.getMessage()).append('\n');
        return sb.toString();
    }
}
