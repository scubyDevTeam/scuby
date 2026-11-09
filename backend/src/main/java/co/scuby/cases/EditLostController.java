package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** editLost: 204. The body is bound without @Valid: its rules run after the owner check (L1 design §3). */
@ApiComponent
@RestController
class EditLostController {

    private final EditLostService service;

    EditLostController(EditLostService service) {
        this.service = service;
    }

    @PatchMapping("/lost-cases/{code}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void edit(@PathVariable String code, Account account, Caller caller, @RequestBody EditLostRequest body) {
        service.edit(code, account, caller, body);
    }
}
