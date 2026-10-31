package co.scuby.platform.telemetry;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** SCUBY_TELEMETRY_EXPORT is the single switch for all three exporters; checked on application.yml alone, so no exporter starts. */
class TelemetrySwitchTest {

    private static final String[] ENABLE_FLAGS = {
            "management.tracing.export.otlp.enabled",
            "management.otlp.metrics.export.enabled",
            "management.logging.export.otlp.enabled"
    };

    private StandardEnvironment environment(Map<String, Object> variables) throws IOException {
        return environment(variables, null);
    }

    private StandardEnvironment environment(Map<String, Object> variables, String profile) throws IOException {
        var env = new StandardEnvironment();
        env.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        env.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml"))
                .forEach(env.getPropertySources()::addLast);
        if (profile != null) {
            new YamlPropertySourceLoader().load(profile, new ClassPathResource("application-" + profile + ".yml"))
                    .forEach(env.getPropertySources()::addFirst);
        }
        env.getPropertySources().addFirst(new MapPropertySource("variables", variables));
        return env;
    }

    @Test
    void exportVariableTurnsAllThreeOn() throws IOException {
        var env = environment(Map.of("SCUBY_TELEMETRY_EXPORT", "true"));
        for (String flag : ENABLE_FLAGS) {
            assertThat(env.getProperty(flag, Boolean.class)).as(flag).isTrue();
        }
    }

    @Test
    void withoutTheVariableAllThreeAreOff() throws IOException {
        var env = environment(Map.of());
        for (String flag : ENABLE_FLAGS) {
            assertThat(env.getProperty(flag, Boolean.class)).as(flag).isFalse();
        }
    }

    @Test
    void environmentDefaultsToLocalAndFollowsTheVariable() throws IOException {
        assertThat(environment(Map.of()).getProperty("management.opentelemetry.resource-attributes.deployment.environment")).isEqualTo("local");
        assertThat(environment(Map.of("SCUBY_ENVIRONMENT", "prod")).getProperty("management.opentelemetry.resource-attributes.deployment.environment")).isEqualTo("prod");
    }

    @Test
    void serverProfilesNameTheirEnvironmentWhenTheVariableIsMissing() throws IOException {
        for (String profile : new String[] {"staging", "prod"}) {
            assertThat(environment(Map.of(), profile).getProperty("management.opentelemetry.resource-attributes.deployment.environment")).as(profile).isEqualTo(profile);
        }
        assertThat(environment(Map.of("SCUBY_ENVIRONMENT", "sandbox"), "staging").getProperty("management.opentelemetry.resource-attributes.deployment.environment")).isEqualTo("sandbox");
    }
}
