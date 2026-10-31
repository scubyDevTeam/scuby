package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;

@Component
class GoogleIdTokens {

    private static final Logger log = LoggerFactory.getLogger(GoogleIdTokens.class);

    private final JwtDecoder decoder;

    GoogleIdTokens(JwtDecoder decoder) {
        this.decoder = decoder;
    }

    /**
     * A bad token — signature, algorithm, issuer, audience, expiry, unverified email — is `unauthorized`.
     * Not being able to fetch Google's keys is our outage, not the caller's fault: `server_error`.
     */
    private static boolean rateLimited(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof com.nimbusds.jose.jwk.source.RateLimitReachedException) return true;
        }
        return false;
    }

    GoogleIdentity verify(String credential) {
        Jwt jwt;
        try {
            jwt = decoder.decode(credential);
        } catch (BadJwtException e) {
            log.debug("Google token rejected: {}", e.getMessage());   // never the credential itself
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Google rejected the token");
        } catch (JwtException e) {
            if (rateLimited(e)) {
                log.debug("Google token refused: its key id is unknown and the key set was refetched too recently");
                throw new ApiException(ErrorCode.UNAUTHORIZED, "Google rejected the token");
            }
            log.error("Google sign-in unavailable: could not fetch or use Google's JWKS key set", e);
            throw new ApiException(ErrorCode.SERVER_ERROR, "Google sign-in is unavailable");
        }
        Object verified = jwt.getClaim("email_verified");
        String email = jwt.getClaimAsString("email");
        if (!(Boolean.TRUE.equals(verified) || "true".equals(verified)) || email == null || jwt.getSubject() == null) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Google account email is not verified");
        }
        String name = jwt.getClaimAsString("name");
        return new GoogleIdentity(jwt.getSubject(), email, name, jwt.getClaimAsString("hd"));
    }
}
