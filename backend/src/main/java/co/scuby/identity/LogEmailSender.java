package co.scuby.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** local, test and staging: the code goes to the log. Not under prod — prod has no sender until O23 closes. */
@Component
@Profile("!prod")
class LogEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(LogEmailSender.class);

    @Override
    public void sendSignInCode(String email, String code) {
        log.info("sign-in code for {}: {}", email, code);
    }
}
