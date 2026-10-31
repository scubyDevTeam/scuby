package co.scuby.platform.telemetry;

import ch.qos.logback.classic.LoggerContext;
import co.scuby.TestcontainersConfiguration;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.resources.Resource;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/** Without SCUBY_TELEMETRY_EXPORT=true nothing is exported, and logs still reach OpenTelemetry (docs/eng/backend.md · Observability). */
@SpringBootTest(properties = "scuby.test.context=telemetry-defaults") // own cache key: never reuses a context whose logging another class reset
@ActiveProfiles("test") // the thin slice refuses the local media store under no profile
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Import(TestcontainersConfiguration.class)
class TelemetryDefaultsTest {

    @Autowired Environment env;
    @Autowired Resource resource;

    /** Logging is initialised once per JVM, and a re-initialisation resets the root logger for every cached context. */
    @BeforeAll
    static void reinitialiseLogging() {
        LoggingSystem.get(TelemetryDefaultsTest.class.getClassLoader()).cleanUp();
    }

    @Test
    void exportsAreOffByDefault() {
        assertThat(env.getProperty("management.tracing.export.otlp.enabled", Boolean.class)).isFalse();
        assertThat(env.getProperty("management.otlp.metrics.export.enabled", Boolean.class)).isFalse();
        assertThat(env.getProperty("management.logging.export.otlp.enabled", Boolean.class)).isFalse();
    }

    @Test
    void identifiesTheServiceAndSamplesEverything() {
        assertThat(resource.getAttribute(AttributeKey.stringKey("service.name"))).isEqualTo("scuby-backend");
        assertThat(resource.getAttribute(AttributeKey.stringKey("deployment.environment"))).isEqualTo("local");
        assertThat(env.getProperty("management.tracing.sampling.probability", Double.class)).isEqualTo(1.0);
    }

    @Test
    void rootLoggerFeedsOpenTelemetry() {
        var root = ((LoggerContext) LoggerFactory.getILoggerFactory()).getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        assertThat(root.getAppender("OTEL")).isNotNull();
        assertThat(root.getAppender("OTEL").isStarted()).isTrue();
    }
}
