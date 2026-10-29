package co.scuby.platform.telemetry;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.AbstractEnvironment;
import org.springframework.core.env.StandardEnvironment;

import static org.assertj.core.api.Assertions.assertThat;

/** The newrelic profile must not start without a license key: an unresolved header would make every export fail with 403, silently. */
class NewRelicLicenseKeyCheckTest {

    /** Cuts the OS environment and JVM properties off, so a NEW_RELIC_LICENSE_KEY exported in the developer's shell cannot change a case. */
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withInitializer(ctx -> {
                var sources = ctx.getEnvironment().getPropertySources();
                sources.remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
                sources.remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
            })
            .withUserConfiguration(NewRelicLicenseKeyCheck.class);

    private ApplicationContextRunner withProfile() {
        return runner.withPropertyValues(AbstractEnvironment.ACTIVE_PROFILES_PROPERTY_NAME + "=newrelic");
    }

    @Test
    void theRunnerDoesNotSeeTheOsEnvironment() {
        runner.run(ctx -> {
            assertThat(ctx.getEnvironment().getPropertySources().contains(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME)).isFalse();
            assertThat(ctx.getEnvironment().containsProperty("NEW_RELIC_LICENSE_KEY")).isFalse();
            assertThat(ctx.getEnvironment().containsProperty("PATH")).isFalse();
        });
    }

    @Test
    void missingKeyFailsStartup() {
        withProfile().run(ctx -> assertThat(ctx).hasFailed().getFailure()
                .rootCause().isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("newrelic.license-key")
                .hasMessageContaining("NEW_RELIC_LICENSE_KEY"));
    }

    @Test
    void blankKeyFailsStartupWithoutEchoingIt() {
        withProfile().withPropertyValues("newrelic.license-key=", "NEW_RELIC_LICENSE_KEY=   ").run(ctx -> assertThat(ctx).hasFailed().getFailure()
                .rootCause().isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("newrelic.license-key")
                .hasMessageContaining("NEW_RELIC_LICENSE_KEY")
                .satisfies(e -> assertThat(e.getMessage()).doesNotContain("   ")));
    }

    @Test
    void emptyEnvironmentVariableFailsStartup() {
        withProfile().withPropertyValues("NEW_RELIC_LICENSE_KEY=").run(ctx -> assertThat(ctx).hasFailed());
    }

    @Test
    void environmentVariableNameStarts() {
        withProfile().withPropertyValues("NEW_RELIC_LICENSE_KEY=secret-from-env").run(ctx -> assertThat(ctx).hasNotFailed());
    }

    @Test
    void propertyNameStarts() {
        withProfile().withPropertyValues("newrelic.license-key=secret-from-property").run(ctx -> assertThat(ctx).hasNotFailed());
    }

    @Test
    void failureMessageNeverContainsAValue() {
        withProfile().withPropertyValues("newrelic.license-key=").run(ctx -> assertThat(ctx).getFailure().rootCause().hasMessageNotContaining("secret"));
    }

    @Test
    void withoutTheProfileTheCheckIsAbsent() {
        runner.run(ctx -> assertThat(ctx).doesNotHaveBean(NewRelicLicenseKeyCheck.class));
    }
}
