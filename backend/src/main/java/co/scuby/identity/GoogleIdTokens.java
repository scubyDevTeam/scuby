package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;

@Component
class GoogleIdTokens {

    private final JwtDecoder decoder;

    GoogleIdTokens(JwtDecoder decoder) {
        this.decoder = decoder;
    }

    /** Any failure — signature, issuer, audience, expiry, unverified email — is `unauthorized`. */
    GoogleIdentity verify(String credential) {
        Jwt jwt;
        try {
            jwt = decoder.decode(credential);
        } catch (JwtException e) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Google rejected the token");
        }
        Object verified = jwt.getClaim("email_verified");
        String email = jwt.getClaimAsString("email");
        if (!(Boolean.TRUE.equals(verified) || "true".equals(verified)) || email == null || jwt.getSubject() == null) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Google account email is not verified");
        }
        String name = jwt.getClaimAsString("name");
        return new GoogleIdentity(jwt.getSubject(), email, name);
    }
}
