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

    private final CodeSends codeSends;

    private final EmailCodes emailCodes;

    private final PhoneOtp phoneOtp;

    IdentityPurge(SessionStore sessions, CodeSends codeSends, EmailCodes emailCodes, PhoneOtp phoneOtp) {
        this.phoneOtp = phoneOtp;
        this.sessions = sessions;
        this.codeSends = codeSends;
        this.emailCodes = emailCodes;
    }

    @Scheduled(cron = "${scuby.purge.cron:0 17 3 * * *}", zone = "UTC")
    void purge() {
        log.info("purged {} expired sessions", sessions.purgeExpired());
        log.info("purged {} code-send rows older than 30 days", codeSends.purgeOlderThan(java.time.Duration.ofDays(30)));
        log.info("purged {} stale email codes", emailCodes.purgeStale());
        log.info("purged {} stale OTP rows older than 30 days", phoneOtp.purgeExpiredBefore(java.time.Duration.ofDays(30)));
    }
}
