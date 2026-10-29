package co.scuby.platform.telemetry;

import org.springframework.context.annotation.Configuration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.core.env.Environment;

/**
 * Refuses to start with SCUBY_TELEMETRY_EXPORT=true and no license key. Boot leaves an unresolvable
 * placeholder in the OTLP header as literal text, so without this every export would be rejected
 * (403) silently. Resolves the key the way application.yml does (the property wins, even
 * empty; the environment variable is the fallback) and never puts a value in the message.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnBooleanProperty("scuby.telemetry.export")
class NewRelicLicenseKeyCheck {

    NewRelicLicenseKeyCheck(Environment env) {
        String key = env.getProperty("newrelic.license-key", env.getProperty("NEW_RELIC_LICENSE_KEY"));
        if (key == null || key.isBlank()) {
            throw new IllegalStateException(
                    "SCUBY_TELEMETRY_EXPORT=true needs a license key: set newrelic.license-key or NEW_RELIC_LICENSE_KEY (it is missing or empty)");
        }
    }
}
