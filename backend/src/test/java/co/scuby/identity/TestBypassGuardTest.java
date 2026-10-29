package co.scuby.identity;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/** Unit-level only: ProfileStartupTest.prodRefusesATestBypassInTheRealContext proves the guard is wired into the real app. */
class TestBypassGuardTest {

    @Configuration
    @EnableConfigurationProperties(TestBypass.class)
    static class Config {}

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(Config.class, TestBypassGuard.class);

    @Test
    void anEmailBypassUnderProdFailsStartUp() {
        runner.withInitializer(ctx -> ctx.getEnvironment().setActiveProfiles("prod"))
              .withPropertyValues("scuby.auth.test-bypass.email-domains=e2e.scuby.test")
              .run(ctx -> assertThat(ctx).hasFailed().getFailure().rootCause().hasMessageContaining("test bypass"));
    }

    @Test
    void anSmsBypassUnderProdFailsStartUp() {
        runner.withInitializer(ctx -> ctx.getEnvironment().setActiveProfiles("prod"))
              .withPropertyValues("scuby.auth.test-bypass.sms-prefixes=+5730000000")
              .run(ctx -> assertThat(ctx).hasFailed().getFailure().rootCause().hasMessageContaining("test bypass"));
    }

    @Test
    void noBypassUnderProdStarts() {
        runner.withInitializer(ctx -> ctx.getEnvironment().setActiveProfiles("prod"))
              .run(ctx -> assertThat(ctx).hasNotFailed());
    }

    @Test
    void aBypassElsewhereStarts() {
        runner.withInitializer(ctx -> ctx.getEnvironment().setActiveProfiles("staging"))
              .withPropertyValues("scuby.auth.test-bypass.sms-prefixes=+5730000000")
              .run(ctx -> assertThat(ctx).hasNotFailed());
    }
}
