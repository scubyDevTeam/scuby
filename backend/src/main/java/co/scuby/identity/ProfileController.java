package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** The caller's own profile (contract `getProfile`). Read-only: one person lookup, no transaction. */
@ApiComponent
@RestController
class ProfileController {

    private final People people;

    ProfileController(People people) {
        this.people = people;
    }

    @GetMapping("/me/profile")
    ProfileView profile(Account account) {
        return ProfileView.of(people.get(account.personId()));
    }
}
