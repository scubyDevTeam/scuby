package co.scuby.identity;

import co.scuby.platform.config.Prod;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
class TestBypassGuard {
    TestBypassGuard(TestBypass bypass, Environment env) {
        Prod.refuse(env, bypass.any(), "a sign-in/SMS test bypass is configured (scuby.auth.test-bypass)");
    }
}
