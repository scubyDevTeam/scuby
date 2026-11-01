package co.scuby.cases;

import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;

/** The first two steps of every owner endpoint (spec §3): the case exists (not_found), the caller is its owner (forbidden). */
@Component
class OwnerAccess {

    private final CaseAccessPolicy policy;

    OwnerAccess(CaseAccessPolicy policy) {
        this.policy = policy;
    }

    /** A path code, upper-cased; anything that cannot be a code is not_found (as CaseCodes.normalize). */
    static String code(String raw) {
        return CaseCodes.normalize(raw).orElseThrow(CaseErrors::notFound);
    }

    /** A path id; a malformed one is simply unknown. */
    static Optional<UUID> id(String raw) {
        try {
            return Optional.of(UUID.fromString(raw));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    <T> T require(Optional<T> row, Function<T, UUID> createdBy, UUID me) {
        T found = row.orElseThrow(CaseErrors::notFound);
        if (!policy.isOwner(createdBy.apply(found), me)) throw CaseErrors.forbidden();
        return found;
    }
}
