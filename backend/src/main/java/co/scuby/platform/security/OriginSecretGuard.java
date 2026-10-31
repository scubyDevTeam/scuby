package co.scuby.platform.security;

import co.scuby.platform.config.Prod;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Under prod the origin secret must be set (it was checked by the client-address component, removed with the IP limits). */
@Component
class OriginSecretGuard {

    OriginSecretGuard(WebProperties web, Environment env) {
        Prod.refuse(env, web.originSecret().isBlank(), "scuby.web.origin-secret is empty (env SCUBY_WEB_ORIGIN_SECRET)");
    }
}
