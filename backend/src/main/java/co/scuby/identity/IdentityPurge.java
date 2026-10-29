package co.scuby.identity;

import co.scuby.platform.roles.WorkerComponent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/** Daily housekeeping of identity's rows (worker role). Later tasks add their own purges here. */
@WorkerComponent
class IdentityPurge {

    private static final Logger log = LoggerFactory.getLogger(IdentityPurge.class);

    private final SessionStore sessions;

    IdentityPurge(SessionStore sessions) {
        this.sessions = sessions;
    }

    @Scheduled(cron = "${scuby.purge.cron:0 17 3 * * *}", zone = "UTC")
    void purge() {
        log.info("purged {} expired sessions", sessions.purgeExpired());
    }
}
