package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** claimRecovery: 201 {id, whatsapp_url}, also for a repeat (the refreshed open claim; 201 is the contract's only success status). A session is required (contract, decision #75). */
@ApiComponent
@RestController
class RecoveryClaimController {

    private final RecoveryClaimService service;

    RecoveryClaimController(RecoveryClaimService service) {
        this.service = service;
    }

    /** answerRecoveryClaim: 200 {id: the claim id}. */
    @PostMapping("/cases/{code}/claims/{claimId}")
    CreatedView answer(@PathVariable String code, @PathVariable String claimId, Account account, @RequestBody ClaimAnswerRequest body) {
        return service.answer(code, claimId, account.personId(), body);
    }

    @PostMapping("/cases/{code}/recovery-claims")
    @ResponseStatus(HttpStatus.CREATED)
    ClaimCreatedView claim(@PathVariable String code, Account account, Caller caller, @RequestBody RecoveryClaimRequest body) {
        return service.claim(code, account, caller, body);
    }
}
