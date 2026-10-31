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
        return createdBy.equals(caller.personId()) ? Access.OWNER : Access.PUBLIC;
    }
}
