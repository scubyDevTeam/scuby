package co.scuby.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * local, test and staging: the code goes to the log, with a masked recipient (first character + `***@` + domain),
 * so a log store never holds a full address next to a live code. Not under prod — prod has no sender until O23 closes.
 */
@Component
@Profile("!prod")
class LogEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(LogEmailSender.class);

    static String mask(String email) {
        int at = email.indexOf('@');
        return at <= 0 ? "***" : email.charAt(0) + "***" + email.substring(at);
    }

    @Override
    public void sendSignInCode(String email, String code) {
        log.info("sign-in code for {}: {}", mask(email), code);
    }
}
