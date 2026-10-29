package co.scuby.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** local, test and staging: the code goes to the log. Not under prod (no provider until O23 closes). */
@Component
@Profile("!prod")
class LogSmsSender implements SmsSender {

    private static final Logger log = LoggerFactory.getLogger(LogSmsSender.class);

    @Override
    public void sendCode(String e164, String code) {
        log.info("SMS code for {}: {}", e164, code);
    }
}
