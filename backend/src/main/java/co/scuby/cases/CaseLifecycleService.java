package co.scuby.cases;

import co.scuby.cases.CaseLifecycleRequests.CancelRequest;
import co.scuby.cases.CaseLifecycleRequests.ReuniteRequest;
import co.scuby.cases.LifecycleQueries.LifecycleRow;
import co.scuby.cases.LostLifecycleDerivation.Action;
import co.scuby.cases.LostLifecycleDerivation.Outcome;
import co.scuby.platform.db.UniqueViolation;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/**
 * Reunite, cancel, reopen (docs/product/04-lost-workflow.md · Case state machine; L1 design §4.3–4.5). Order: the case
 * exists → the caller is its owner → the body → the status. Each transition is one conditional UPDATE in autocommit; zero
 * rows after a passing pre-read is the race loser and answers what one re-read classifies. Idempotent: a case already in
 * the action's target state answers the same success with no write (a retry after a lost response, a double tap, or a
 * race another request won), so the first call's resolution and attribution are never overwritten; any other state is
 * invalid_transition. Never re-broadcasts, notifies no one, writes no outbox row (L2 derives what it needs from rows).
 */
@Service
class CaseLifecycleService {

    private final LifecycleQueries queries;
    private final OwnerAccess owners;
    private final Clock clock;

    CaseLifecycleService(LifecycleQueries queries, OwnerAccess owners, Clock clock) {
        this.queries = queries;
        this.owners = owners;
        this.clock = clock;
    }

    String reunite(String rawCode, UUID me, ReuniteRequest body) {
        String code = OwnerAccess.code(rawCode);
        LifecycleRow row = owners.require(queries.load(code), LifecycleRow::createdBy, me);
        if (!LostLifecycleDerivation.isAttribution(body.resolutionAttribution())) {
            throw CaseErrors.invalidField("resolution_attribution", "one of platform_sighting, platform_claim, platform_share, offline, unknown");
        }
        Instant now = clock.instant();
        return close(Action.REUNITE, row, now, () -> queries.close(code, me, "reunited", "reunited_home", body.resolutionAttribution(), now));
    }

    String cancel(String rawCode, UUID me, CancelRequest body) {
        String code = OwnerAccess.code(rawCode);
        LifecycleRow row = owners.require(queries.load(code), LifecycleRow::createdBy, me);
        if (!LostLifecycleDerivation.isCancelReason(body.resolution())) {
            throw CaseErrors.invalidField("resolution", "false_alarm or duplicate");
        }
        Instant now = clock.instant();
        return close(Action.CANCEL, row, now, () -> queries.close(code, me, "cancelled", body.resolution(), null, now));
    }

    /**
     * One close. ALREADY_DONE on the pre-read answers the code with no write; ALLOWED runs the conditional UPDATE; zero
     * rows is the race loser, and one re-read tells "already in the target state" (the code, nothing written) from any
     * other state (invalid_transition).
     */
    private String close(Action action, LifecycleRow row, Instant now, BooleanSupplier update) {
        Outcome before = LostLifecycleDerivation.check(action, row.status(), row.resolvedAt(), now);
        if (before == Outcome.ALREADY_DONE) return row.code();
        if (before != Outcome.ALLOWED) throw CaseErrors.invalidTransition();
        if (update.getAsBoolean()) return row.code();
        LifecycleRow after = queries.load(row.code()).orElseThrow(CaseErrors::notFound);
        if (LostLifecycleDerivation.check(action, after.status(), after.resolvedAt(), now) == Outcome.ALREADY_DONE) return row.code();
        throw CaseErrors.invalidTransition();
    }

    String reopen(String rawCode, UUID me) {
        String code = OwnerAccess.code(rawCode);
        LifecycleRow row = owners.require(queries.load(code), LifecycleRow::createdBy, me);
        Instant now = clock.instant();
        if (alreadyActive(row, now)) return code;
        boolean reopened;
        try {
            reopened = queries.reopen(code, me, now);
        } catch (RuntimeException e) {
            if (!UniqueViolation.on(e, LifecycleQueries.ACTIVE_PER_PET)) throw e;
            throw queries.activeCodeFor(row.petId()).map(CaseErrors::activeCaseExists).orElseGet(CaseErrors::invalidTransition);
        }
        if (reopened) return code;
        // The race loser: a claim's reactivation may have made the case active first — what the owner asked for.
        if (alreadyActive(queries.load(code).orElseThrow(CaseErrors::notFound), now)) return code;
        throw CaseErrors.invalidTransition();
    }

    /**
     * True when this case is already active (reopen has nothing to do); otherwise invalid_transition first (status or
     * window), then active_case_exists (spec §4.5), then invalid_transition again for an older case; false when it is reopenable.
     */
    private static boolean alreadyActive(LifecycleRow row, Instant now) {
        Outcome outcome = LostLifecycleDerivation.check(Action.REOPEN, row.status(), row.resolvedAt(), now);
        if (outcome == Outcome.ALREADY_DONE) return true;
        if (outcome != Outcome.ALLOWED) throw CaseErrors.invalidTransition();
        if (row.otherActiveCode() != null) throw CaseErrors.activeCaseExists(row.otherActiveCode());
        if (row.superseded()) throw CaseErrors.invalidTransition();   // decision #81: only the pet's newest case comes back
        return false;
    }
}
