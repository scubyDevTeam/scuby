package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** The caller's own profile (contract `getProfile`, `updateProfile`). */
@ApiComponent
@RestController
class ProfileController {

    private final People people;
    private final ProfileUpdates updates;

    ProfileController(People people, ProfileUpdates updates) {
        this.people = people;
        this.updates = updates;
    }

    @GetMapping("/me/profile")
    ProfileView profile(Account account) {
        return ProfileView.of(people.get(account.personId()));
    }

    /** updateProfile: 200 Profile. Bound without @Valid: ProfileTextDerivation holds the rules (session first, by /me/**). */
    @PatchMapping("/me/profile")
    ProfileView update(Account account, Caller caller, @RequestBody ProfileUpdateRequest body) {
        return updates.update(account, caller, body);
    }
}
