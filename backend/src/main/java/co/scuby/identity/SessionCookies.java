package co.scuby.identity;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The session cookie of decision #37: httpOnly, Secure, SameSite=Lax, on the API's own host. The
 * `__Host-` prefix (Secure, Path=/, no Domain) stops a sibling subdomain from planting one; a request
 * carrying the name twice is treated as having none.
 */
@Component
class SessionCookies {

    static final String NAME = "__Host-session";
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private final Clock clock;

    SessionCookies(Clock clock) {
        this.clock = clock;
    }

    Optional<String> read(HttpServletRequest request) {
        Cookie[] all = request.getCookies();
        if (all == null) return Optional.empty();
        String found = null;
        for (Cookie c : all) {
            if (!NAME.equals(c.getName())) continue;
            if (found != null) return Optional.empty();   // duplicated: a planted cookie (cookie tossing)
            found = c.getValue();
        }
        return found != null && TOKEN.matcher(found).matches() ? Optional.of(found) : Optional.empty();
    }

    /** Max-Age from the session's own expires_at, so the cookie and the session end together. */
    void issue(HttpServletResponse response, NewSession session) {
        Duration maxAge = Duration.between(clock.instant(), session.expiresAt());
        response.addHeader(HttpHeaders.SET_COOKIE, base(session.token()).maxAge(maxAge).build().toString());
    }

    void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, base("").maxAge(Duration.ZERO).build().toString());
    }

    /** Always Secure: a `__Host-` cookie without it is dropped by browsers, so `scuby.cookies.secure` does not apply here. */
    private ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(NAME, value).httpOnly(true).secure(true).sameSite("Lax").path("/");
    }
}
