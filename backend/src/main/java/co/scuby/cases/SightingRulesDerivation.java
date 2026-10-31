package co.scuby.cases;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * «Lo vi» rules (docs/product/04-lost-workflow.md · Validation) and the rate-limit decision. Pure.
 * The 15-minute rule of 04 is waived inside the earlier pin's 15-minute correction window — the same
 * 15 minutes — so it never fires; it is deliberately not implemented (reported as an open question).
 */
final class SightingRulesDerivation {

    enum Refusal { SEEN_AT_IN_FUTURE, SEEN_AT_BEFORE_CASE, SIGHTING_TOO_FAR }

    record Counts(int onCase, int total) {}

    record Limits(int perCase, int perReporter, int perCasePerIp, int perIp) {}

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

    static boolean limited(Counts reporter, Counts ip, Limits limits) {
        return reporter.onCase() >= limits.perCase() || reporter.total() >= limits.perReporter()
                || ip.onCase() >= limits.perCasePerIp() || ip.total() >= limits.perIp();
    }
}
