package co.scuby.platform.web;

import co.scuby.platform.config.Prod;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.WebProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The client's IP (a rate-limit key, design · Sighting rate limits): CloudFront-Viewer-Address only
 * when the request proves it came through CloudFront (origin secret header), else the socket address.
 */
@Component
public class ClientAddress {

    static final String DEFAULT_KEY = "local-only-ip-hash-key";
    static final int MIN_KEY_LENGTH = 32;

    private static final Logger log = LoggerFactory.getLogger(ClientAddress.class);
    private final AtomicBoolean warnedNoViewerAddress = new AtomicBoolean();

    private final WebProperties web;

    public ClientAddress(WebProperties web, Environment env) {
        this.web = web;
        String key = web.ipHashKey();
        Prod.requireDeployed(env, key != null && !key.isBlank() && !DEFAULT_KEY.equals(key) && key.length() >= MIN_KEY_LENGTH,
                "scuby.web.ip-hash-key (env SCUBY_WEB_IP_HASH_KEY; at least " + MIN_KEY_LENGTH
                        + " characters, not blank, not the local default, which makes IP hashes reversible)");
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
                    String host = viewer.substring(0, viewer.lastIndexOf(':'));  // "ip:port", IPv6 included
                    return host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
                }
                if (warnedNoViewerAddress.compareAndSet(false, true)) {
                    log.warn("Request vouched for by the origin secret has no parseable CloudFront-Viewer-Address: "
                            + "using the socket address, so per-IP limits become per-edge (is the origin request policy "
                            + "forwarding it?). Logged once.");
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
