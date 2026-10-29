package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class GoogleSignInController {

    record GoogleSignInRequest(@NotBlank String credential) {}

    private final GoogleSignIn signIn;
    private final SignInSessions sessions;

    GoogleSignInController(GoogleSignIn signIn, SignInSessions sessions) {
        this.signIn = signIn;
        this.sessions = sessions;
    }

    @PostMapping("/auth/google")
    UserView google(@Valid @RequestBody GoogleSignInRequest body, HttpServletRequest request, HttpServletResponse response) {
        Person person = signIn.signIn(body.credential());
        sessions.open(person.id(), request, response);
        return UserView.of(person);
    }
}
