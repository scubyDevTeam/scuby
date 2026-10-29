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

    @Bean
    co.scuby.support.GoogleTestKeys googleTestKeys() {
        return new co.scuby.support.GoogleTestKeys();
    }

    /** The production decoder recipe (RS256 only, same validators); only the key fetch is replaced. */
    @Bean
    @Primary
    org.springframework.security.oauth2.jwt.JwtDecoder testGoogleIdTokenDecoder(co.scuby.support.GoogleTestKeys keys, java.time.Clock clock) {
        return GoogleIdTokenConfiguration.decoder("http://google-jwks.test/certs", keys.jwksFetcher(),
                co.scuby.support.GoogleTestKeys.CLIENT_ID, clock, java.time.Duration.ofMillis(1));
    }
}
