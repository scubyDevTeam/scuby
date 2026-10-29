package co.scuby.platform.flags;

import co.scuby.platform.cache.ClearableCache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.LoadingCache;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static co.scuby.db.generated.Tables.FEATURE_FLAGS;
import static co.scuby.db.generated.Tables.FEATURE_FLAG_OVERRIDES;

/**
 * The one evaluation function (docs/eng/feature-flags.md · Model): the account's override if one
 * exists, else the global value. Backend only; a flag never reaches the wire.
 *
 * <p>Evaluation reads an in-memory snapshot of both tables, reloaded at most every cache-ttl (30 s):
 * no SQL per call while the snapshot is warm, and a flip is seen within that window.
 */
@Component
public class FeatureFlags implements ClearableCache {

    private static final Logger log = LoggerFactory.getLogger(FeatureFlags.class);

    private record Snapshot(Map<String, Boolean> globals, Map<String, Map<UUID, Boolean>> overrides) {}

    private static final Object ONLY = new Object();

    private final DSLContext db;
    private final LoadingCache<Object, Snapshot> snapshot;

    public FeatureFlags(DSLContext db, FlagProperties properties) {
        this.db = db;
        this.snapshot = Caffeine.newBuilder().expireAfterWrite(properties.cacheTtl()).build(k -> load());
    }

    public boolean isEnabled(Flag flag, @Nullable UUID personId) {
        Snapshot s = snapshot.get(ONLY);
        Boolean global = s.globals().get(flag.key());
        if (global == null) return false;
        if (personId != null) {
            Boolean override = s.overrides().getOrDefault(flag.key(), Map.of()).get(personId);
            if (override != null) return override;
        }
        return global;
    }

    @Override
    public void clear() {
        snapshot.invalidateAll();
    }

    private Snapshot load() {
        Map<String, Boolean> globals = new HashMap<>();
        db.select(FEATURE_FLAGS.KEY, FEATURE_FLAGS.ENABLED).from(FEATURE_FLAGS)
          .forEach(r -> globals.put(r.value1(), r.value2()));
        Map<String, Map<UUID, Boolean>> overrides = new HashMap<>();
        db.select(FEATURE_FLAG_OVERRIDES.FLAG_KEY, FEATURE_FLAG_OVERRIDES.PERSON_ID, FEATURE_FLAG_OVERRIDES.ENABLED)
          .from(FEATURE_FLAG_OVERRIDES)
          .forEach(r -> overrides.computeIfAbsent(r.value1(), k -> new HashMap<>()).put(r.value2(), r.value3()));
        for (Flag f : Flag.values()) {
            if (!globals.containsKey(f.key())) {
                log.warn("feature flag '{}' is not in feature_flags: evaluating as off", f.key());
            }
        }
        return new Snapshot(Map.copyOf(globals), Map.copyOf(overrides));
    }
}
