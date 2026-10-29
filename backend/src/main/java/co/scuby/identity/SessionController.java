package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class SessionController {

    private final People people;
    private final SessionStore store;
    private final SessionCookies cookies;

    SessionController(People people, SessionStore store, SessionCookies cookies) {
        this.people = people;
        this.store = store;
        this.cookies = cookies;
    }

    @GetMapping("/session")
    UserView session(Account account) {
        return UserView.of(people.get(account.personId()));
    }

    /** 204 whether or not there was a session (contract: signOut). */
    @PostMapping("/auth/sign-out")
    ResponseEntity<Void> signOut(HttpServletRequest request, HttpServletResponse response) {
        cookies.read(request).map(Hashing::sha256Hex).ifPresent(store::delete);
        cookies.clear(response);
        return ResponseEntity.noContent().build();
    }
}
