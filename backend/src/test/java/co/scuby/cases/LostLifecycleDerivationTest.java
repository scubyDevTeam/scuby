package co.scuby.cases;

import co.scuby.cases.LostLifecycleDerivation.Action;
import co.scuby.cases.LostLifecycleDerivation.Outcome;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Which lifecycle action a lost case allows (docs/product/04 · Case state machine; spec §3, §4.3–4.5, §4.9).
 * Human review: this table is the rule. The reopen window is 30 days from resolved_at, INCLUSIVE. An action whose target
 * state the case is already in is ALREADY_DONE (a retry or a double tap answers its success and writes nothing); any
 * other state that is not the action's start is INVALID_TRANSITION.
 */
class LostLifecycleDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");

    @ParameterizedTest(name = "{0} on {1}, resolved {2} ago → {3}")
    @CsvSource(nullValues = "null", value = {
            // action,  status,    resolved ago,   outcome
            "REUNITE,  active,    null,           ALLOWED",
            "REUNITE,  expired,   P1D,            ALLOWED",
            "REUNITE,  expired,   P29D,           ALLOWED",
            "REUNITE,  expired,   P90D,           ALLOWED",
            "REUNITE,  reunited,  P1D,            ALREADY_DONE",
            "REUNITE,  cancelled, P1D,            INVALID_TRANSITION",
            "CANCEL,   active,    null,           ALLOWED",
            "CANCEL,   expired,   P1D,            INVALID_TRANSITION",
            "CANCEL,   reunited,  P1D,            INVALID_TRANSITION",
            "CANCEL,   cancelled, P1D,            ALREADY_DONE",
            "REOPEN,   expired,   P29D,           ALLOWED",
            "REOPEN,   expired,   P30D,           ALLOWED",
            "REOPEN,   expired,   PT720H0.001S,   INVALID_TRANSITION",
            "REOPEN,   expired,   null,           INVALID_TRANSITION",
            "REOPEN,   active,    null,           ALREADY_DONE",
            "REOPEN,   reunited,  P1D,            INVALID_TRANSITION",
            "REOPEN,   cancelled, P1D,            INVALID_TRANSITION",
            "CLAIM,    active,    null,           ALLOWED",
            "CLAIM,    expired,   P29D,           REACTIVATE",
            "CLAIM,    expired,   P30D,           REACTIVATE",
            "CLAIM,    expired,   PT720H0.001S,   INVALID_TRANSITION",
            "CLAIM,    expired,   null,           INVALID_TRANSITION",
            "CLAIM,    reunited,  P1D,            INVALID_TRANSITION",
            "CLAIM,    cancelled, P1D,            INVALID_TRANSITION",
    })
    void theTransitionTable(Action action, String status, Duration resolvedAgo, Outcome expected) {
        Instant resolvedAt = resolvedAgo == null ? null : NOW.minus(resolvedAgo);
        assertThat(LostLifecycleDerivation.check(action, status, resolvedAt, NOW)).isEqualTo(expected);
    }

    @Test
    void theWindowIsInclusiveAtThirtyDaysAndItsSqlCutoffAgrees() {
        Instant edge = NOW.minus(Duration.ofDays(30));
        assertThat(LostLifecycleDerivation.insideReopenWindow(edge, NOW)).isTrue();
        assertThat(LostLifecycleDerivation.insideReopenWindow(edge.minusMillis(1), NOW)).isFalse();
        assertThat(LostLifecycleDerivation.insideReopenWindow(NOW, NOW)).isTrue();
        assertThat(LostLifecycleDerivation.insideReopenWindow(null, NOW)).isFalse();
        // SQL writes `resolved_at >= reopenCutoff(now)`: the same instant is inside.
        assertThat(LostLifecycleDerivation.reopenCutoff(NOW)).isEqualTo(edge);
        assertThat(LostLifecycleDerivation.REOPEN_WINDOW).isEqualTo(Duration.ofDays(30));
    }

    @ParameterizedTest(name = "attribution {0} → {1}")
    @CsvSource(nullValues = "null", value = {
            "platform_sighting, true", "platform_claim, true", "platform_share, true", "offline, true", "unknown, true",
            "luck, false", "'', false", "null, false", "PLATFORM_CLAIM, false", "reunited_home, false",
    })
    void theFiveAttributions(String value, boolean valid) {
        assertThat(LostLifecycleDerivation.isAttribution(value)).isEqualTo(valid);
    }

    @ParameterizedTest(name = "cancel reason {0} → {1}")
    @CsvSource(nullValues = "null", value = {
            "false_alarm, true", "duplicate, true",
            "reunited_home, false", "no_response, false", "gave_up, false", "found_deceased, false", "null, false", "'', false",
    })
    void onlyTwoCancelReasonsInL1(String value, boolean valid) {
        assertThat(LostLifecycleDerivation.isCancelReason(value)).isEqualTo(valid);
    }
}
