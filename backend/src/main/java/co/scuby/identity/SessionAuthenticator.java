package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.RequestAuthenticator;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/** The session cookie → the signed-in person. Read-only (design · Sessions: reading never writes). */
@Component
class SessionAuthenticator implements RequestAuthenticator {

    private final SessionCookies cookies;
    private final SessionLookup lookup;

    SessionAuthenticator(SessionCookies cookies, SessionLookup lookup) {
        this.cookies = cookies;
        this.lookup = lookup;
    }

    @Override
    public Optional<UUID> authenticate(HttpServletRequest request) {
        return cookies.read(request).map(Hashing::sha256Hex).flatMap(lookup::find).map(ActiveSession::personId);
    }
}
