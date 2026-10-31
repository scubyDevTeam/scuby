package co.scuby.identity;

import co.scuby.platform.config.Prod;
import co.scuby.platform.crypto.Hashing;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Sign-in and OTP codes at rest: an HMAC, so a database leak alone does not reveal a live code. */
@Component
class CodeHasher {

    static final String DEFAULT_KEY = "local-only-code-hash-key";
    static final int MIN_KEY_LENGTH = 32;

    private final String key;

    CodeHasher(AuthProperties auth, Environment env) {
        Prod.requireDeployed(env, usable(auth.codeHashKey()),
                "scuby.auth.code-hash-key (env SCUBY_AUTH_CODE_HASH_KEY; at least " + MIN_KEY_LENGTH
                        + " characters, not blank, not the local default, which makes stored codes guessable)");
        this.key = auth.codeHashKey();
    }

    private static boolean usable(String key) {
        return key != null && !key.isBlank() && !DEFAULT_KEY.equals(key) && key.length() >= MIN_KEY_LENGTH;
    }

    String hash(String subject, String code) {
        return Hashing.hmacSha256Hex(key, subject + ":" + code);
    }

    /** Constant-time comparison of a stored hash with the hash of a submitted code. */
    boolean matches(String storedHash, String subject, String code) {
        return java.security.MessageDigest.isEqual(
                storedHash.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                hash(subject, code).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
