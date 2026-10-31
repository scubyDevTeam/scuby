package co.scuby.uploads;

import co.scuby.platform.config.Prod;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
class MediaConfiguration {

    @Bean
    @ConditionalOnProperty(name = "scuby.media.store", havingValue = "local", matchIfMissing = true)
    LocalMediaStore localMediaStore(MediaProperties properties, Environment env) {
        // Prod never runs on the local directory; staging sets s3 in its yml, so a local store there is an override: warn.
        String why = "scuby.media.store=local: photos live in a local directory and the /dev-media routes are off, so uploads cannot work";
        Prod.refuse(env, true, why);
        Prod.warnDeployed(env, true, why);
        return new LocalMediaStore(properties);
    }

    @Bean
    @ConditionalOnProperty(name = "scuby.media.store", havingValue = "s3")
    MediaStore s3MediaStore(MediaProperties properties) {
        // The instance role authorises S3 (docs/eng/infra.md · Secrets): the default chain finds it, lazily
        // (no credential lookup and no network call until the first request).
        return new S3MediaStore(properties, DefaultCredentialsProvider.builder().build());
    }
}
