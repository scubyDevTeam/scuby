package co.scuby.platform.telemetry;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

/**
 * Sends every log record to Spring Boot's OpenTelemetry SDK (exported only with the newrelic profile).
 * Attached in code, not in logback-spring.xml, so Boot keeps its default console — the only one that
 * honours logging.structured.format.console. Lines logged before this bean exists reach stdout only.
 */
@Component
class OpenTelemetryLogbackInstaller implements InitializingBean, DisposableBean {

    private static final String APPENDER_NAME = "OTEL";

    private final OpenTelemetry openTelemetry;

    OpenTelemetryLogbackInstaller(OpenTelemetry openTelemetry) {
        this.openTelemetry = openTelemetry;
    }

    @Override
    public void afterPropertiesSet() {
        Logger root = rootLogger();
        detach(root);
        OpenTelemetryAppender appender = new OpenTelemetryAppender();
        appender.setName(APPENDER_NAME);
        appender.setContext(root.getLoggerContext());
        appender.setCaptureCodeAttributes(false);
        appender.setOpenTelemetry(openTelemetry);
        appender.start();
        root.addAppender(appender);
    }

    @Override
    public void destroy() {
        detach(rootLogger());
    }

    private static Logger rootLogger() {
        return ((LoggerContext) LoggerFactory.getILoggerFactory()).getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
    }

    private static void detach(Logger root) {
        var existing = root.getAppender(APPENDER_NAME);
        if (existing != null) {
            root.detachAppender(existing);
            existing.stop();
        }
    }
}
