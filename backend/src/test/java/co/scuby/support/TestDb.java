package co.scuby.support;

import co.scuby.platform.cache.ClearableCache;
import org.jooq.DSLContext;
import co.scuby.db.generated.tables.records.FeatureFlagsRecord;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static co.scuby.db.generated.Tables.FEATURE_FLAGS;

/** Puts the shared database and in-process state back to a known start before each test. */
public final class TestDb {

    /** Every table a test may write. Each task that adds a writable table adds it here. */
    static final List<String> MUTABLE_TABLES = List.of(
            "outbox_events",
            "feature_flag_overrides",
            "feature_flag_changes",
            "session",
            "email_code",
            "code_send",
            "phone_otp",
            "person",
            "upload"
    );

    /**
     * Tables a test never writes: seeded by migrations and restored by reset() (feature_flags) or read-only
     * (supported_countries), plus Flyway's own history. A new table is in exactly one of the two lists;
     * HarnessSelfTest fails otherwise.
     */
    static final List<String> REFERENCE_TABLES = List.of("feature_flags", "supported_countries", "flyway_schema_history");

    private final DSLContext db;
    private final ObjectProvider<ClearableCache> caches;
    private final MutableClock clock;
    private final StatementRecorder recorder;
    private final ConnectionSampler sampler;
    private final ObjectProvider<RecordingEmailSender> emails;
    private final ObjectProvider<RecordingSmsSender> sms;

    TestDb(DSLContext db, ObjectProvider<ClearableCache> caches, MutableClock clock, StatementRecorder recorder,
           ConnectionSampler sampler,
           ObjectProvider<RecordingEmailSender> emails, ObjectProvider<RecordingSmsSender> sms) {
        this.emails = emails;
        this.sms = sms;
        this.db = db;
        this.caches = caches;
        this.clock = clock;
        this.recorder = recorder;
        this.sampler = sampler;
    }

    /** feature_flags as Flyway left it (the migration's seeds), captured the first time reset() runs. */
    private List<FeatureFlagsRecord> flagSeeds;

    private void restoreFlagSeeds() {
        if (flagSeeds == null) {
            flagSeeds = List.copyOf(db.selectFrom(FEATURE_FLAGS).fetch());
        }
        db.deleteFrom(FEATURE_FLAGS).execute();
        for (FeatureFlagsRecord r : flagSeeds) {
            r.changed(true);
            db.insertInto(FEATURE_FLAGS).set(r).execute();
        }
    }

    public void reset() {
        db.execute("TRUNCATE " + String.join(", ", MUTABLE_TABLES.stream().map(t -> "scuby." + t).toList())
                + " RESTART IDENTITY CASCADE");
        restoreFlagSeeds();
        db.execute("TRUNCATE scuby.feature_flag_changes RESTART IDENTITY");
        caches.orderedStream().forEach(ClearableCache::clear);
        clock.reset();
        recorder.reset();
        sampler.reset();
        emails.ifAvailable(RecordingEmailSender::clear);
        sms.ifAvailable(RecordingSmsSender::clear);
    }
}
