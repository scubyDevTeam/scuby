package co.scuby.platform.telemetry;

import co.scuby.TestcontainersConfiguration;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.resources.Resource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.logging.LoggingInitializationContext;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.logging.LoggingSystemProperty;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.test.annotation.DirtiesContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

/** What the server variables switch on: New Relic export settings and the WARN-and-up JSON console (decision #38). */
@SpringBootTest(properties = {
        "SCUBY_ENVIRONMENT=staging",
        "SCUBY_CONSOLE_FORMAT=ecs",
        "SCUBY_CONSOLE_THRESHOLD=WARN",
        "NEW_RELIC_LICENSE_KEY=test-not-a-key",
        "SCUBY_TELEMETRY_EXPORT=false" // nothing may leave the machine
})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Import(TestcontainersConfiguration.class)
@ExtendWith(OutputCaptureExtension.class)
class ServerTelemetryTest {

    private static final Logger log = LoggerFactory.getLogger(ServerTelemetryTest.class);

    @Autowired Environment env;
    @Autowired Resource resource;

    /** Logging is initialised once per JVM, and a re-initialisation resets the root logger for every cached context. */
    @BeforeAll
    static void reinitialiseLogging() {
        LoggingSystem.get(ServerTelemetryTest.class.getClassLoader()).cleanUp();
    }

    /** Gives later classes that reuse cached contexts the plain INFO console back (their OTEL appender stays detached; only TelemetryDefaultsTest asserts it, in its own context). */
    @AfterAll
    static void restoreDefaultLogging() {
        LoggingSystem logging = LoggingSystem.get(ServerTelemetryTest.class.getClassLoader());
        logging.cleanUp();
        // Boot publishes these as JVM system properties when this context starts, and a later initialisation reads them back.
        System.clearProperty(LoggingSystemProperty.CONSOLE_STRUCTURED_FORMAT.getEnvironmentVariableName());
        System.clearProperty(LoggingSystemProperty.CONSOLE_THRESHOLD.getEnvironmentVariableName());
        logging.beforeInitialize();
        logging.initialize(new LoggingInitializationContext(new StandardEnvironment()), null, null);
    }

    @Test
    void stagingSendsToNewRelicAsStaging() {
        assertThat(resource.getAttribute(AttributeKey.stringKey("deployment.environment"))).isEqualTo("staging");
        assertThat(env.getProperty("management.otlp.metrics.export.url")).isEqualTo("https://otlp.nr-data.net:4318/v1/metrics");
        assertThat(env.getProperty("management.opentelemetry.tracing.export.otlp.endpoint")).isEqualTo("https://otlp.nr-data.net:4318/v1/traces");
        assertThat(env.getProperty("management.opentelemetry.logging.export.otlp.endpoint")).isEqualTo("https://otlp.nr-data.net:4318/v1/logs");
        assertThat(env.getProperty("management.opentelemetry.tracing.export.otlp.headers.api-key")).isEqualTo("test-not-a-key");
        assertThat(env.getProperty("management.opentelemetry.logging.export.otlp.headers.api-key")).isEqualTo("test-not-a-key");
        assertThat(env.getProperty("management.otlp.metrics.export.headers.api-key")).isEqualTo("test-not-a-key");
    }

    @Test
    void consoleCarriesOnlyWarnAndUpAsJson(CapturedOutput output) {
        log.info("telemetry-probe-info");
        log.warn("telemetry-probe-warn");

        assertThat(output.getOut()).doesNotContain("telemetry-probe-info");
        String line = Arrays.stream(output.getOut().split("\n"))
                .filter(l -> l.contains("telemetry-probe-warn"))
                .findFirst().orElseThrow();
        JsonNode json = JsonMapper.builder().build().readTree(line);
        assertThat(json.path("log").path("level").asString()).isEqualTo("WARN");
        assertThat(json.path("message").asString()).isEqualTo("telemetry-probe-warn");
    }
}
