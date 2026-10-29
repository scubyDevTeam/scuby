package co.scuby.identity;

import co.scuby.support.GoogleTestKeys;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.JwtException;

import java.time.Clock;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Tokens naming unknown key ids must not make us call Google each time: the key set is refetched at most once per interval. */
class GoogleKeyRefetchTest {

    @Test
    void unknownKeyIdsRefetchTheKeySetOncePerIntervalNotOncePerToken() {
        GoogleTestKeys keys = new GoogleTestKeys();
        var decoder = GoogleIdTokenConfiguration.decoder("http://google-jwks.test/certs", keys.jwksFetcher(),
                GoogleTestKeys.CLIENT_ID, Clock.systemUTC(), Duration.ofMinutes(2));
        String known = keys.token(GoogleTestKeys.claims("s", "a@gmail.com", java.time.Instant.now()));
        String unknown = keys.tokenWithUnknownKeyId(GoogleTestKeys.claims("s", "a@gmail.com", java.time.Instant.now()));

        decoder.decode(known);
        int afterWarmUp = keys.fetchCount();
        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> decoder.decode(unknown)).isInstanceOf(JwtException.class);
        }
        assertThat(keys.fetchCount() - afterWarmUp).as("fetches caused by 5 unknown-kid tokens").isLessThanOrEqualTo(1);
        decoder.decode(known);                                                      // the cached keys still verify
        assertThat(keys.fetchCount() - afterWarmUp).isLessThanOrEqualTo(1);
    }
}
