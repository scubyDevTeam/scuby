package co.scuby.cases;

import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** scuby.sightings.*: «Lo vi» limits per rolling 24 h (reporter: 04 · Validation; IP: decided in the thin slice). */
@Validated
@ConfigurationProperties("scuby.sightings")
record SightingProperties(@Min(value = 1, message = "scuby.sightings.per-case must be set and at least 1") int perCase,
                          @Min(value = 1, message = "scuby.sightings.per-reporter must be set and at least 1") int perReporter,
                          @Min(value = 1, message = "scuby.sightings.per-case-per-ip must be set and at least 1") int perCasePerIp,
                          @Min(value = 1, message = "scuby.sightings.per-ip must be set and at least 1") int perIp) {
    SightingRulesDerivation.Limits limits() {
        return new SightingRulesDerivation.Limits(perCase, perReporter, perCasePerIp, perIp);
    }
}
