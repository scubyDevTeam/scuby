package co.scuby.support;

import co.scuby.platform.cache.ClearableCache;
import org.jooq.DSLContext;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

/** Puts the shared database and in-process state back to a known start before each test. */
public final class TestDb {

    /** Every table a test may write. Each task that adds a writable table adds it here. */
    static final List<String> MUTABLE_TABLES = List.of(
            "outbox_events"
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

    public void reset() {
        db.execute("TRUNCATE " + String.join(", ", MUTABLE_TABLES.stream().map(t -> "scuby." + t).toList())
                + " RESTART IDENTITY CASCADE");
        caches.orderedStream().forEach(ClearableCache::clear);
        clock.reset();
        recorder.reset();
        sampler.reset();
    }
}
