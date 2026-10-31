package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The anonymous identity (decision #35): set by the API, only its hash used server-side. Renewed on
 * unsafe requests (where it is used); never written to the database by this filter.
 */
final class DeviceCookieFilter extends OncePerRequestFilter {

    static final String COOKIE = "device";
    private static final Pattern VALUE = Pattern.compile("^[A-Za-z0-9_-]{43}$");
    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    private final CookieProperties cookies;

    DeviceCookieFilter(CookieProperties cookies) {
        this.cookies = cookies;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String value = read(request);
        boolean valid = value != null && VALUE.matcher(value).matches();
        if (!valid) value = Hashing.randomToken(32);
        request.setAttribute(Caller.DEVICE_HASH_ATTRIBUTE, Hashing.sha256Hex(value));
        boolean preflight = "OPTIONS".equals(request.getMethod());
        if (!preflight && (!valid || !SAFE.contains(request.getMethod()))) {
            response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(COOKIE, value)
                    .httpOnly(true).secure(cookies.secure()).sameSite("Lax").path("/")
                    .maxAge(Duration.ofDays(365)).build().toString());
        }
        chain.doFilter(request, response);
    }

    /** The cookie's value; null when absent or present more than once (a planted duplicate: cookie tossing). */
    private static String read(HttpServletRequest request) {
        Cookie[] all = request.getCookies();
        if (all == null) return null;
        String found = null;
        for (Cookie c : all) {
            if (!COOKIE.equals(c.getName())) continue;
            if (found != null) return null;
            found = c.getValue();
        }
        return found;
    }
}
