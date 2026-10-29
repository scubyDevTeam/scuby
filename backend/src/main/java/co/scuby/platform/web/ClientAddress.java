package co.scuby.platform.web;

import co.scuby.platform.config.Prod;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.WebProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * The client's IP (a rate-limit key, design · Sighting rate limits): CloudFront-Viewer-Address only
 * when the request proves it came through CloudFront (origin secret header), else the socket address.
 */
@Component
public class ClientAddress {

    static final String DEFAULT_KEY = "local-only-ip-hash-key";

    private final WebProperties web;

    public ClientAddress(WebProperties web, Environment env) {
        this.web = web;
        Prod.requireDeployed(env, !DEFAULT_KEY.equals(web.ipHashKey()),
                "scuby.web.ip-hash-key (env SCUBY_WEB_IP_HASH_KEY; the local default makes IP hashes reversible)");
        Prod.refuse(env, web.originSecret().isBlank(), "scuby.web.origin-secret is empty (env SCUBY_WEB_ORIGIN_SECRET)");
        Prod.warnDeployed(env, web.originSecret().isBlank(),
                "scuby.web.origin-secret is empty: every request will have CloudFront's IP, so per-IP limits become global");
    }

    public String ip(HttpServletRequest request) {
        if (!web.originSecret().isBlank()) {
            String presented = request.getHeader(web.originSecretHeader());
            if (presented != null && MessageDigest.isEqual(presented.getBytes(StandardCharsets.UTF_8),
                    web.originSecret().getBytes(StandardCharsets.UTF_8))) {
                String viewer = request.getHeader("CloudFront-Viewer-Address");
                if (viewer != null && viewer.lastIndexOf(':') > 0) {
                    return viewer.substring(0, viewer.lastIndexOf(':'));  // "ip:port", IPv6 included
                }
            }
        }
        return request.getRemoteAddr();
    }

    /** Stored instead of the IP: enough to count, not to read back. */
    public String ipHash(HttpServletRequest request) {
        return Hashing.hmacSha256Hex(web.ipHashKey(), ip(request));
    }
}
