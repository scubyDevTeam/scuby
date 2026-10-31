package co.scuby.cases;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/** docs/product/04-lost-workflow.md · Validation, and the design's rate limits. Human review: these tables are the rules. */
class SightingRulesDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");
    static final Instant LAST_SEEN = NOW.minus(Duration.ofDays(2));

    @ParameterizedTest(name = "seen {0} min from now, {1} m away → {2}")
    @CsvSource(nullValues = "none", value = {
            "0,      100,    none",
            "5,      100,    none",                  // exactly the 5-minute drift: accepted
            "6,      100,    SEEN_AT_IN_FUTURE",
            "-4320,  100,    none",                  // exactly 24 h before last seen (last seen = 2 days ago): accepted
            "-4321,  100,    SEEN_AT_BEFORE_CASE",
            "0,      30000,  none",                  // exactly 30 km: accepted
            "0,      30001,  SIGHTING_TOO_FAR",
            "60,     99999,  SEEN_AT_IN_FUTURE",      // order: future, before, too far
            "-5000,  99999,  SEEN_AT_BEFORE_CASE",
    })
    void validation(long minutesFromNow, double distance, String expected) {
        Optional<SightingRulesDerivation.Refusal> r = SightingRulesDerivation.check(
                NOW.plus(Duration.ofMinutes(minutesFromNow)), NOW, LAST_SEEN, distance);
        assertThat(r.map(Enum::name).orElse(null)).isEqualTo(expected);
    }

    @ParameterizedTest(name = "reporter {0}/{1}, ip {2}/{3} → {4}")
    @CsvSource({
            "0,  0,  0,  0,  false",
            "4,  19, 19, 79, false",
            "5,  5,  0,  0,  true",     // 5 per reporter per case
            "0,  20, 0,  0,  true",     // 20 per reporter
            "0,  0,  20, 20, true",     // 20 per IP per case
            "0,  0,  0,  80, true",     // 80 per IP
    })
    void rateLimits(int onCase, int total, int ipOnCase, int ipTotal, boolean limited) {
        var limits = new SightingRulesDerivation.Limits(5, 20, 20, 80);
        assertThat(SightingRulesDerivation.limited(new SightingRulesDerivation.Counts(onCase, total),
                new SightingRulesDerivation.Counts(ipOnCase, ipTotal), limits)).isEqualTo(limited);
    }
}
