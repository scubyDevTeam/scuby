package co.scuby.uploads;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.ZoneOffset;

import static co.scuby.db.generated.Tables.UPLOAD;
import static org.assertj.core.api.Assertions.assertThat;

/** The daily purge keeps `upload` to the attach window (MediaProperties.attachWindow, 24 h): older rows can no longer be attached. */
@IntegrationTest
class UploadPurgeTest {

    @Autowired UploadPurge purge;
    @Autowired MediaProperties media;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired TestDb testDb;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    private void slot(String name, Duration age) {
        db.insertInto(UPLOAD)
          .set(UPLOAD.OWNER_KEY, "d:" + "a".repeat(64))
          .set(UPLOAD.SHA256, name.repeat(64))
          .set(UPLOAD.PURPOSE, "sighting")
          .set(UPLOAD.BYTES, 3)
          .set(UPLOAD.CREATED_AT, clock.instant().minus(age).atOffset(ZoneOffset.UTC))
          .execute();
    }

    @Test
    void theWindowIsTheAttachWindow() {
        assertThat(media.attachWindow()).isEqualTo(Duration.ofHours(24));
    }

    @Test
    void deletesRowsThatCanNoLongerBeAttachedAndKeepsTheRest() {
        slot("1", Duration.ofHours(25));
        slot("2", media.attachWindow());                       // exactly the window: no longer attachable
        slot("3", media.attachWindow().minusSeconds(1));       // still attachable
        slot("4", Duration.ofMinutes(5));
        assertThat(purge.deleteExpired()).isEqualTo(2);
        assertThat(db.select(UPLOAD.SHA256).from(UPLOAD).fetch(UPLOAD.SHA256))
                .containsExactlyInAnyOrder("3".repeat(64), "4".repeat(64));
    }

    @Test
    void followsTheClockAndTheConfiguredWindow() {
        slot("5", Duration.ofHours(1));
        assertThat(purge.deleteExpired()).isZero();
        clock.advance(media.attachWindow());                   // the row is now one window + 1 h old
        assertThat(purge.deleteExpired()).isEqualTo(1);
        assertThat(db.fetchCount(UPLOAD)).isZero();
    }

    @Test
    void theScheduledEntryPointPurgesToo() {
        slot("6", Duration.ofDays(3));
        purge.purge();
        assertThat(db.fetchCount(UPLOAD)).isZero();
    }
}
