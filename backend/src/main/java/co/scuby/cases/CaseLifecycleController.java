package co.scuby.cases;

import co.scuby.cases.CaseLifecycleRequests.CancelRequest;
import co.scuby.cases.CaseLifecycleRequests.ReuniteRequest;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** reuniteCase, cancelCase, reopenCase: 200 {id: the case code}. Bodies bound without @Valid (the service validates). */
@ApiComponent
@RestController
class CaseLifecycleController {

    private final CaseLifecycleService service;

    CaseLifecycleController(CaseLifecycleService service) {
        this.service = service;
    }

    @PostMapping("/cases/{code}/reunite")
    CreatedView reunite(@PathVariable String code, Account account, @RequestBody ReuniteRequest body) {
        return new CreatedView(service.reunite(code, account.personId(), body));
    }

    @PostMapping("/cases/{code}/cancel")
    CreatedView cancel(@PathVariable String code, Account account, @RequestBody CancelRequest body) {
        return new CreatedView(service.cancel(code, account.personId(), body));
    }

    @PostMapping("/cases/{code}/reopen")
    CreatedView reopen(@PathVariable String code, Account account) {
        return new CreatedView(service.reopen(code, account.personId()));
    }
}
