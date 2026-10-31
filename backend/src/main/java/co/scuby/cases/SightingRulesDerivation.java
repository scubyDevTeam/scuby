package co.scuby.cases;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * «Lo vi» rules (docs/product/04-lost-workflow.md · Validation). Pure.
 * The 15-minute rule of 04 is waived inside the earlier pin's 15-minute correction window — the same
 * 15 minutes — so it never fires; it is deliberately not implemented (reported as an open question).
 */
final class SightingRulesDerivation {

    enum Refusal { SEEN_AT_IN_FUTURE, SEEN_AT_BEFORE_CASE, SIGHTING_TOO_FAR }

    static final Duration CLOCK_DRIFT = Duration.ofMinutes(5);
    static final Duration BEFORE_CASE = Duration.ofHours(24);
    static final double MAX_DISTANCE_M = 30_000;

    private SightingRulesDerivation() {}

    static Optional<Refusal> check(Instant seenAt, Instant now, Instant lastSeenAt, double distanceM) {
        if (seenAt.isAfter(now.plus(CLOCK_DRIFT))) return Optional.of(Refusal.SEEN_AT_IN_FUTURE);
        if (seenAt.isBefore(lastSeenAt.minus(BEFORE_CASE))) return Optional.of(Refusal.SEEN_AT_BEFORE_CASE);
        if (distanceM > MAX_DISTANCE_M) return Optional.of(Refusal.SIGHTING_TOO_FAR);
        return Optional.empty();
    }
}
