package co.scuby.support;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.mock.http.client.MockClientHttpResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestOperations;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

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

    private volatile boolean jwksDown;
    private final java.util.concurrent.atomic.AtomicInteger fetches = new java.util.concurrent.atomic.AtomicInteger();

    /** How many times the key set was fetched (an outage attempt counts too). */
    public int fetchCount() { return fetches.get(); }

    /** While down, fetching Google's keys fails like a network outage. */
    public void jwksDown(boolean down) { jwksDown = down; }

    /** Stands in for the HTTP call to Google's JWKS URL. */
    public RestOperations jwksFetcher() {
        return new RestTemplate((uri, method) -> new MockClientHttpRequest(method, uri) {
            @Override protected org.springframework.http.client.ClientHttpResponse executeInternal() throws IOException {
                fetches.incrementAndGet();
                if (jwksDown) throw new IOException("jwks down");
                String json = new JWKSet(new RSAKey.Builder(publicKey()).keyID("test").build()).toString();
                MockClientHttpResponse r = new MockClientHttpResponse(json.getBytes(StandardCharsets.UTF_8), HttpStatus.OK);
                r.getHeaders().setContentType(MediaType.APPLICATION_JSON);
                return r;
            }
        });
    }

    public RSAPublicKey publicKey() { return (RSAPublicKey) ours.getPublic(); }

    public String token(Map<String, Object> claims) { return sign(claims, ours); }

    /** Signed by our key but naming a key id the cached key set does not have: forces a key refetch. */
    public String tokenWithUnknownKeyId(Map<String, Object> claims) { return sign(claims, ours, "rotated-key"); }

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

    private static String sign(Map<String, Object> claims, KeyPair key) { return sign(claims, key, "test"); }

    private static String sign(Map<String, Object> claims, KeyPair key, String kid) {
        try {
            JWTClaimsSet.Builder b = new JWTClaimsSet.Builder();
            claims.forEach((k, v) -> b.claim(k, v instanceof List<?> l ? l : v));
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(kid).build(), b.build());
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
