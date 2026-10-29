package co.scuby.platform.telemetry;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * Refuses to start when telemetry export is on (scuby.telemetry.export, from SCUBY_TELEMETRY_EXPORT)
 * and there is no license key. Boot leaves an unresolvable placeholder in the OTLP header as literal
 * text, so without this every export would be rejected (403) silently. The switch is read as a
 * Boolean, exactly as the exporters read the flags it feeds (so yes/on/1 count as on, too). The key
 * is resolved the way application.yml does (the property wins, even empty; the environment variable
 * is the fallback) and a value never appears in the message.
 */
@Configuration(proxyBeanMethods = false)
class NewRelicLicenseKeyCheck {

    NewRelicLicenseKeyCheck(Environment env) {
        if (!Boolean.TRUE.equals(env.getProperty("scuby.telemetry.export", Boolean.class))) {
            return;
        }
        String key = env.getProperty("newrelic.license-key", env.getProperty("NEW_RELIC_LICENSE_KEY"));
        if (key == null || key.isBlank()) {
            throw new IllegalStateException(
                    "SCUBY_TELEMETRY_EXPORT=true needs a license key: set newrelic.license-key or NEW_RELIC_LICENSE_KEY (it is missing or empty)");
        }
    }
}
