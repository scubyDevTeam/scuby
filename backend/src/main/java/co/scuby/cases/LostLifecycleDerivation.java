package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;

/**
 * Which lifecycle action a lost case allows now (docs/product/04-lost-workflow.md · Case state machine). Pure.
 * Reunite and cancel close an active case; reopen brings back an expired one within REOPEN_WINDOW of resolved_at
 * (inclusive); a claim on an expired case inside the window reactivates it first (decision #29). An owner action on a
 * case already in its target state is ALREADY_DONE: the endpoint answers its success and writes nothing (a retry after a
 * lost response, a double tap, or a race another request won), so the first call's resolution and attribution stay.
 */
final class LostLifecycleDerivation {

    /** Measured from resolved_at, inclusive: !now.isAfter(resolvedAt + 30 d); SQL resolved_at >= now − 30 d. */
    static final Duration REOPEN_WINDOW = Duration.ofDays(30);

    private static final Set<String> ATTRIBUTIONS = Set.of("platform_sighting", "platform_claim", "platform_share", "offline", "unknown");
    /** L1 writes only these two; found_deceased and gave_up are a proposal to the client (open item O35). */
    private static final Set<String> CANCEL_REASONS = Set.of("false_alarm", "duplicate");

    enum Action { REUNITE, CANCEL, REOPEN, CLAIM }

    enum Outcome { ALLOWED, REACTIVATE, ALREADY_DONE, INVALID_TRANSITION }

    private LostLifecycleDerivation() {}

    static Outcome check(Action action, String status, @Nullable Instant resolvedAt, Instant now) {
        boolean active = "active".equals(status);
        boolean reopenable = "expired".equals(status) && insideReopenWindow(resolvedAt, now);
        return switch (action) {
            case REUNITE -> active ? Outcome.ALLOWED : "reunited".equals(status) ? Outcome.ALREADY_DONE : Outcome.INVALID_TRANSITION;
            case CANCEL -> active ? Outcome.ALLOWED : "cancelled".equals(status) ? Outcome.ALREADY_DONE : Outcome.INVALID_TRANSITION;
            case REOPEN -> active ? Outcome.ALREADY_DONE : reopenable ? Outcome.ALLOWED : Outcome.INVALID_TRANSITION;
            case CLAIM -> active ? Outcome.ALLOWED : reopenable ? Outcome.REACTIVATE : Outcome.INVALID_TRANSITION;
        };
    }

    static boolean insideReopenWindow(@Nullable Instant resolvedAt, Instant now) {
        return resolvedAt != null && !now.isAfter(resolvedAt.plus(REOPEN_WINDOW));
    }

    /** The SQL form of the window: resolved_at >= reopenCutoff(now). */
    static Instant reopenCutoff(Instant now) {
        return now.minus(REOPEN_WINDOW);
    }

    static boolean isAttribution(@Nullable String value) {
        return value != null && ATTRIBUTIONS.contains(value);
    }

    static boolean isCancelReason(@Nullable String value) {
        return value != null && CANCEL_REASONS.contains(value);
    }
}
