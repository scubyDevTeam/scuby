package co.scuby.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * prod until open item O23 closes: there is no email provider. Prod still starts (ProfileStartupTest),
 * but says so at start-up and fails every send — a 500, never a silent non-send.
 */
@Component
@Profile("prod")
class UnavailableEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(UnavailableEmailSender.class);

    UnavailableEmailSender() {
        log.error("No email provider under prod (open item O23): email-code sign-in will fail with server_error");
    }

    @Override
    public void sendSignInCode(String email, String code) {
        throw new IllegalStateException("no email provider under prod (open item O23)");
    }
}
