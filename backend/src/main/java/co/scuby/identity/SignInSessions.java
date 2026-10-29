package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Every sign-in ends here: the session the browser carried (if any) ends, a new one starts. The database
 * part ({@link #open}) must run inside the sign-in's own transaction, after the account row is locked, so
 * resolving the account and opening its session are one atomic step; the cookie follows commit.
 */
@Component
class SignInSessions {

    private final SessionStore store;
    private final SessionCookies cookies;

    SignInSessions(SessionStore store, SessionCookies cookies) {
        this.store = store;
        this.cookies = cookies;
    }

    /** The hash of the session token the browser carried, if it carried a well-formed one. */
    Optional<String> carried(HttpServletRequest request) {
        return cookies.read(request).map(Hashing::sha256Hex);
    }

    /** Joins the caller's transaction (MANDATORY: a session must never be opened outside the sign-in's lock). */
    @Transactional(propagation = Propagation.MANDATORY)
    NewSession open(UUID personId, Optional<String> carriedTokenHash) {
        carriedTokenHash.ifPresent(store::delete);
        return store.create(personId);
    }

    void issue(HttpServletResponse response, NewSession session) {
        cookies.issue(response, session);
    }
}
