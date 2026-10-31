package co.scuby.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** prod until open item O23 closes: no SMS provider. Prod starts, says so, and fails every send (500). */
@Component
@Profile("prod")
class UnavailableSmsSender implements SmsSender {

    private static final Logger log = LoggerFactory.getLogger(UnavailableSmsSender.class);

    UnavailableSmsSender() {
        log.error("No SMS provider under prod (open item O23): phone verification will fail with server_error");
    }

    @Override
    public void sendCode(String e164, String code) {
        throw new IllegalStateException("no SMS provider under prod (open item O23)");
    }
}
