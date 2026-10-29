package co.scuby.support;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** A local stand-in for Google's signing keys: tests never reach the network. */
public final class GoogleTestKeys {

    public static final String CLIENT_ID = "test-google-client-id";

    private final KeyPair ours = generate();
    private final KeyPair theirs = generate();

    public RSAPublicKey publicKey() { return (RSAPublicKey) ours.getPublic(); }

    public String token(Map<String, Object> claims) { return sign(claims, ours); }

    public String tokenSignedByAnotherKey(Map<String, Object> claims) { return sign(claims, theirs); }

    public static Map<String, Object> claims(String sub, String email, Instant now) {
        Map<String, Object> c = new HashMap<>();
        c.put("iss", "https://accounts.google.com");
        c.put("aud", CLIENT_ID);
        c.put("sub", sub);
        c.put("email", email);
        c.put("email_verified", true);
        c.put("name", "Carolina Mejía");
        c.put("iat", Date.from(now));
        c.put("exp", Date.from(now.plusSeconds(3600)));
        return c;
    }

    private static String sign(Map<String, Object> claims, KeyPair key) {
        try {
            JWTClaimsSet.Builder b = new JWTClaimsSet.Builder();
            claims.forEach((k, v) -> b.claim(k, v instanceof List<?> l ? l : v));
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test").build(), b.build());
            jwt.sign(new RSASSASigner(key.getPrivate()));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static KeyPair generate() {
        try {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            return g.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
