package co.scuby.platform.telemetry;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;

/**
 * Refuses to start with the newrelic profile and no license key. Boot leaves an unresolvable
 * placeholder in the OTLP header as literal text, so without this every export would be rejected
 * (403) silently. Resolves the key the way application-newrelic.yml does (the property wins, even
 * empty; the environment variable is the fallback) and never puts a value in the message.
 */
@Configuration(proxyBeanMethods = false)
@Profile("newrelic")
class NewRelicLicenseKeyCheck {

    NewRelicLicenseKeyCheck(Environment env) {
        String key = env.getProperty("newrelic.license-key", env.getProperty("NEW_RELIC_LICENSE_KEY"));
        if (key == null || key.isBlank()) {
            throw new IllegalStateException(
                    "The newrelic profile needs a license key: set newrelic.license-key or NEW_RELIC_LICENSE_KEY (it is missing or empty)");
        }
    }
}
