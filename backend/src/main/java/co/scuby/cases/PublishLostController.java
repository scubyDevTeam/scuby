package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class PublishLostController {

    private final PublishLostService service;

    PublishLostController(PublishLostService service) {
        this.service = service;
    }

    /** 200 with `{phone_step: "otp"}` or `{code}` (the contract's publishLost). */
    @PostMapping("/lost-cases")
    Object publish(Account account, Caller caller, @Valid @RequestBody PublishLostRequest body) {
        return service.publish(account, caller, body);
    }
}
