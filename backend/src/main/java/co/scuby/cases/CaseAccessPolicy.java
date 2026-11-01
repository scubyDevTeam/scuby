package co.scuby.cases;

import co.scuby.platform.security.Caller;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * The one place that decides who sees a case's private side (human review focus): only the person
 * who published it, by session. A device cookie never makes anyone the owner.
 */
@Component
class CaseAccessPolicy {
    Access accessFor(UUID createdBy, Caller caller) {
        return isOwner(createdBy, caller.personId()) ? Access.OWNER : Access.PUBLIC;
    }

    /** The owner of a lost case is the person who published it (lost_case.created_by), by session. */
    boolean isOwner(UUID createdBy, @org.jspecify.annotations.Nullable UUID personId) {
        return createdBy.equals(personId);
    }
}
