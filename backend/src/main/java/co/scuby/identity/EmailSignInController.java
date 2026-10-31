package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class EmailSignInController {

    private final EmailSignIn signIn;
    private final SignInSessions sessions;

    EmailSignInController(EmailSignIn signIn, SignInSessions sessions) {
        this.signIn = signIn;
        this.sessions = sessions;
    }

    /** 204 whether or not a code went out: never reveals whether the address has an account. */
    @PostMapping("/auth/email/start")
    ResponseEntity<Void> start(Caller caller, @Valid @RequestBody EmailRequests.Start body) {
        signIn.start(body.email(), caller);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/auth/email/verify")
    UserView verify(@Valid @RequestBody EmailRequests.Verify body, HttpServletRequest request, HttpServletResponse response) {
        SignedIn done = signIn.verify(body.email(), body.code(), sessions.carried(request));
        sessions.issue(response, done.session());
        return UserView.of(done.person());
    }
}
