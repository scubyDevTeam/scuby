package co.scuby.uploads;

import co.scuby.platform.config.Prod;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
class MediaConfiguration {

    @Bean
    @ConditionalOnProperty(name = "scuby.media.store", havingValue = "local", matchIfMissing = true)
    LocalMediaStore localMediaStore(MediaProperties properties, Environment env) {
        // Warn, not refuse, until the S3 store exists (A2 Task 2 restores Prod.refuse for prod and adds the
        // store's properties to ProfileStartupTest.REQUIRED): today no deployed profile has another store.
        Prod.warnDeployed(env, true, "scuby.media.store=local: photos live in a local directory and the /dev-media routes are off; uploads cannot work until the S3 store lands");
        return new LocalMediaStore(properties);
    }
}
