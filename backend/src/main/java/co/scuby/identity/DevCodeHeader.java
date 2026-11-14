package co.scuby.identity;

import co.scuby.platform.config.Prod;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Local development only: the code of an email or SMS send also goes back as the `X-Dev-Code` response
 * header, which the web client prints to the browser console (docs/eng/auth.md · Codes in development).
 * Off unless `scuby.auth.dev-code-header` is true, and refused in any deployed profile: it would hand any
 * caller the code for any address or number.
 */
@Component
class DevCodeHeader {

    static final String NAME = "X-Dev-Code";

    private final boolean enabled;

    DevCodeHeader(@Value("${scuby.auth.dev-code-header:false}") boolean enabled, Environment env) {
        if (enabled) Prod.refuseDeployed(env, "scuby.auth.dev-code-header");
        this.enabled = enabled;
    }

    /** Sets the header on the response of the request being served, if there is one. */
    void expose(String code) {
        if (!enabled) return;
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes
                && attributes.getResponse() != null) {
            attributes.getResponse().setHeader(NAME, code);
        }
    }
}
