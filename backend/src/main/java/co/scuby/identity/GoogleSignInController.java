package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class GoogleSignInController {

    /** A Google ID token is about 1-1.5 KB; the cap keeps a huge body away from the JWT parser. */
    record GoogleSignInRequest(@NotBlank @Size(max = 4096) String credential) {}

    private final GoogleSignIn signIn;
    private final SignInSessions sessions;

    GoogleSignInController(GoogleSignIn signIn, SignInSessions sessions) {
        this.signIn = signIn;
        this.sessions = sessions;
    }

    @PostMapping("/auth/google")
    UserView google(@Valid @RequestBody GoogleSignInRequest body, Caller caller, HttpServletRequest request, HttpServletResponse response) {
        SignedIn done = signIn.signIn(body.credential(), sessions.carried(request), caller.personId());
        sessions.issue(response, done.session());
        return UserView.of(done.person());
    }
}
