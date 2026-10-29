package co.scuby.identity;

import co.scuby.support.RecordingEmailSender;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Test doubles for identity's package-private ports; imported by TestSupportConfiguration. */
@TestConfiguration(proxyBeanMethods = false)
public class IdentityTestBeans {

    @Bean
    RecordingEmailSender recordingEmailSender() {
        return new RecordingEmailSender();
    }

    @Bean
    @Primary
    EmailSender testEmailSender(RecordingEmailSender recorder) {
        return recorder::record;
    }
}
