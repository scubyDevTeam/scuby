package co.scuby.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** local, test and staging: the code goes to the log, with the number masked to its last 4 digits. Not under prod (no provider until O23 closes). */
@Component
@Profile("!prod")
class LogSmsSender implements SmsSender {

    private static final Logger log = LoggerFactory.getLogger(LogSmsSender.class);

    static String mask(String e164) {
        return "***" + e164.substring(Math.max(0, e164.length() - 4));
    }

    @Override
    public void sendCode(String e164, String code) {
        log.info("SMS code for {}: {}", mask(e164), code);
    }
}
