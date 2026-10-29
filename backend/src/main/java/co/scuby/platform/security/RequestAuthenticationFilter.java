package co.scuby.platform.security;

import co.scuby.platform.web.ErrorCode;
import co.scuby.platform.web.ErrorEnvelopeWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Puts the signed-in person (if any) in the security context. The first authenticator that answers wins.
 * An authenticator that throws (database down) is a 500 in the contract's envelope, not Tomcat's /error.
 */
final class RequestAuthenticationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestAuthenticationFilter.class);

    private final List<RequestAuthenticator> authenticators;
    private final ErrorEnvelopeWriter errors;

    RequestAuthenticationFilter(List<RequestAuthenticator> authenticators, ErrorEnvelopeWriter errors) {
        this.authenticators = List.copyOf(authenticators);
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        for (RequestAuthenticator authenticator : authenticators) {
            Optional<UUID> person;
            try {
                person = authenticator.authenticate(request);
            } catch (RuntimeException e) {
                log.error("Authenticating {} {} failed", request.getMethod(), request.getRequestURI(), e);
                errors.write(response, ErrorCode.SERVER_ERROR);
                return;
            }
            if (person.isPresent()) {
                var context = SecurityContextHolder.createEmptyContext();
                context.setAuthentication(new SignedInAuthentication(person.get()));
                SecurityContextHolder.setContext(context);
                break;
            }
        }
        chain.doFilter(request, response);
    }
}
