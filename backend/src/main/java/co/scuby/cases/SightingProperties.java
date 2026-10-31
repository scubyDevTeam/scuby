package co.scuby.cases;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.sightings.*: «Lo vi» limits per rolling 24 h (reporter: 04 · Validation; IP: decided in the thin slice). */
@ConfigurationProperties("scuby.sightings")
record SightingProperties(int perCase, int perReporter, int perCasePerIp, int perIp) {
    SightingRulesDerivation.Limits limits() {
        return new SightingRulesDerivation.Limits(perCase, perReporter, perCasePerIp, perIp);
    }
}
