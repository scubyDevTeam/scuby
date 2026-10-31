package co.scuby.uploads;

import co.scuby.platform.roles.WorkerComponent;
import org.jooq.DSLContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

import java.time.Clock;
import java.time.ZoneOffset;

import static co.scuby.db.generated.Tables.UPLOAD;

/**
 * Daily housekeeping of the upload table (worker role). A slot older than the attach window
 * ({@link MediaProperties#attachWindow()}, 24 h) can no longer be attached to anything, so its row is dead weight:
 * deleting it keeps the table small instead of indexing it (backend/CLAUDE.md · Migrations and indexes).
 * It lives here because only this package writes `upload`.
 */
@WorkerComponent
class UploadPurge {

    private static final Logger log = LoggerFactory.getLogger(UploadPurge.class);

    private final DSLContext db;
    private final Clock clock;
    private final MediaProperties properties;

    UploadPurge(DSLContext db, Clock clock, MediaProperties properties) {
        this.db = db;
        this.clock = clock;
        this.properties = properties;
    }

    @Scheduled(cron = "${scuby.purge.cron:0 17 3 * * *}", zone = "UTC")
    void purge() {
        log.info("purged {} upload slots older than the attach window", deleteExpired());
    }

    /** Rows PhotoAttachments would no longer accept (created_at not after now minus the window). */
    int deleteExpired() {
        return db.deleteFrom(UPLOAD)
                 .where(UPLOAD.CREATED_AT.le(clock.instant().minus(properties.attachWindow()).atOffset(ZoneOffset.UTC)))
                 .execute();
    }
}
