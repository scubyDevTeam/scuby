package co.scuby.cases;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.Locale;

/** Access → facts → derivation for GET /cases/{code}. No transaction: two autocommit reads. */
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
        LostCaseFacts facts = found.withSightings(queries.sightings(code, access));
        return LostCaseDerivation.derive(facts, new Viewer(access, caller.personId(), caller.deviceHash()), clock.instant(), locale);
    }
}
