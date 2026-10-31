package co.scuby.identity;

import co.scuby.platform.cache.ClearableCache;
import org.jooq.DSLContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

@Configuration(proxyBeanMethods = false)
class SessionConfiguration {

    @Bean
    SessionLookup sessionLookup(DSLContext db, Clock clock, SessionProperties properties) {
        SessionLookup database = new DbSessionLookup(db, clock);
        return properties.cacheSize() == 0 ? database : new CachingSessionLookup(database, properties, clock);
    }

    /** The cache under its own interface: TestDb finds it by declared type, not by the runtime type of sessionLookup. */
    @Bean
    ClearableCache sessionCache(SessionLookup sessionLookup) {
        // A distinct object: returning the lookup itself would make it a second SessionLookup candidate (autowiring by instance).
        return sessionLookup instanceof ClearableCache cache ? cache::clear : () -> {};
    }
}
