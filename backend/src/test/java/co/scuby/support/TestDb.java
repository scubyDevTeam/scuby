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
            "person"
    );

    private final DSLContext db;
    private final ObjectProvider<ClearableCache> caches;
    private final MutableClock clock;
    private final StatementRecorder recorder;
    private final ConnectionSampler sampler;

    TestDb(DSLContext db, ObjectProvider<ClearableCache> caches, MutableClock clock, StatementRecorder recorder,
           ConnectionSampler sampler) {
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
    }
}
