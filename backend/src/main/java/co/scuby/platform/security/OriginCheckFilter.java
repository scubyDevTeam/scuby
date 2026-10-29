package co.scuby.platform.security;

import co.scuby.platform.web.ErrorCode;
import co.scuby.platform.web.ErrorEnvelopeWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Set;

/**
 * CSRF defence without a token (the client sends none): an unsafe request must come from an allowed
 * Origin, or carry no browser evidence of being cross-site (docs/eng/backend.md · Security).
 */
final class OriginCheckFilter extends OncePerRequestFilter {

    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    private final Set<String> allowed;
    private final ErrorEnvelopeWriter errors;

    OriginCheckFilter(List<String> allowedOrigins, ErrorEnvelopeWriter errors) {
        this.allowed = Set.copyOf(allowedOrigins);
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!SAFE.contains(request.getMethod()) && !trusted(request)) {
            errors.write(response, ErrorCode.FORBIDDEN);
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean trusted(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null) return allowed.contains(origin);
        return !"cross-site".equals(request.getHeader("Sec-Fetch-Site"));
    }
}
