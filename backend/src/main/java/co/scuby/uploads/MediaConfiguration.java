package co.scuby.uploads;

import co.scuby.platform.config.Prod;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
class MediaConfiguration {

    @Bean
    // Everything but s3 (missing, local, blank, a typo) builds this bean, so MediaProperties validation
    // runs and names scuby.media.store instead of start-up dying on a missing MediaStore bean.
    @ConditionalOnExpression("!'s3'.equals('${scuby.media.store:}')")
    LocalMediaStore localMediaStore(MediaProperties properties, Environment env) {
        // No deployed profile (staging included) runs on the local directory.
        Prod.refuseDeployed(env, "scuby.media.store=local (photos live in a local directory and the /dev-media routes are off, so uploads cannot work)");
        return new LocalMediaStore(properties);
    }

    @Bean
    @ConditionalOnProperty(name = "scuby.media.store", havingValue = "s3")
    S3MediaStore s3MediaStore(MediaProperties properties) {
        // The instance role authorises S3 (docs/eng/infra.md · Secrets): the default chain finds it, lazily
        // (no credential lookup and no network call until the first request).
        return new S3MediaStore(properties, DefaultCredentialsProvider.builder().build());
    }
}
