package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;

import java.util.UUID;

/** Every sign-in ends here: the session the browser carried (if any) ends, a new one starts. */
@Component
class SignInSessions {

    private final SessionStore store;
    private final SessionCookies cookies;

    SignInSessions(SessionStore store, SessionCookies cookies) {
        this.store = store;
        this.cookies = cookies;
    }

    void open(UUID personId, HttpServletRequest request, HttpServletResponse response) {
        cookies.read(request).map(Hashing::sha256Hex).ifPresent(store::delete);
        cookies.issue(response, store.create(personId));
    }
}
