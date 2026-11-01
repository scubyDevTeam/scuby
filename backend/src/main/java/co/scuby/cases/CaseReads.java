package co.scuby.cases;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.Locale;

/** Access → facts → derivation for GET /cases/{code}. No transaction: autocommit reads (case, sightings, and the claims for the owner only). */
@Component
class CaseReads {

    private final LostCaseQueries queries;
    private final CaseAccessPolicy policy;
    private final Clock clock;

    CaseReads(LostCaseQueries queries, CaseAccessPolicy policy, Clock clock) {
        this.queries = queries;
        this.policy = policy;
        this.clock = clock;
    }

    LostCaseView view(String rawCode, Caller caller, Locale locale) {
        String code = CaseCodes.normalize(rawCode).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "no such case"));
        LostCaseFacts found = queries.loadCase(code).orElseThrow(() -> queries.isPurged(code)
                ? new ApiException(ErrorCode.GONE, "this case was purged")
                : new ApiException(ErrorCode.NOT_FOUND, "no such case"));
        Access access = policy.accessFor(found.createdBy(), caller);
        Instant now = clock.instant();
        LostCaseFacts facts = found.withSightings(queries.sightings(code, access));
        // Private facts are not even queried for a non-owner (the claims and their count are owner-only, decision #76).
        if (access == Access.OWNER) facts = facts.withClaims(queries.claims(code, now));
        return LostCaseDerivation.derive(facts, new Viewer(access, caller.personId(), caller.deviceHash()), now, locale);
    }
}
