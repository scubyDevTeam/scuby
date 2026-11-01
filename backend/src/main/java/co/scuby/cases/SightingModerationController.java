package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** moderateSighting: 200 {id: the sighting id}. Session only for PATCH: DELETE on the same path is the reporter's, public. */
@ApiComponent
@RestController
class SightingModerationController {

    private final SightingModerationService service;

    SightingModerationController(SightingModerationService service) {
        this.service = service;
    }

    @PatchMapping("/cases/{code}/sightings/{sightingId}")
    CreatedView moderate(@PathVariable String code, @PathVariable String sightingId, Account account,
                         @RequestBody ModerateSightingRequest body) {
        return service.moderate(code, sightingId, account.personId(), body);
    }
}
