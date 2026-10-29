package co.scuby.platform.flags;

import co.scuby.platform.cache.ClearableCache;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.UUID;

import static co.scuby.db.generated.Tables.FEATURE_FLAGS;
import static co.scuby.db.generated.Tables.FEATURE_FLAG_OVERRIDES;

/**
 * The one evaluation function (docs/eng/feature-flags.md · Model): the account's override if one
 * exists, else the global value. Backend only; a flag never reaches the wire.
 */
@Component
public class FeatureFlags implements ClearableCache {

    private static final Logger log = LoggerFactory.getLogger(FeatureFlags.class);

    private record Key(Flag flag, @Nullable UUID personId) {}

    private final DSLContext db;
    private final Cache<Key, Boolean> cache;

    public FeatureFlags(DSLContext db, FlagProperties properties) {
        this.db = db;
        this.cache = Caffeine.newBuilder().maximumSize(10_000).expireAfterWrite(properties.cacheTtl()).build();
    }

    public boolean isEnabled(Flag flag, @Nullable UUID personId) {
        return cache.get(new Key(flag, personId), this::load);
    }

    @Override
    public void clear() {
        cache.invalidateAll();
    }

    private Boolean load(Key key) {
        var override = key.personId() == null
                ? DSL.falseCondition()
                : FEATURE_FLAG_OVERRIDES.PERSON_ID.eq(key.personId());
        var row = db.select(FEATURE_FLAGS.ENABLED, FEATURE_FLAG_OVERRIDES.ENABLED)
                    .from(FEATURE_FLAGS)
                    .leftJoin(FEATURE_FLAG_OVERRIDES)
                    .on(FEATURE_FLAG_OVERRIDES.FLAG_KEY.eq(FEATURE_FLAGS.KEY).and(override))
                    .where(FEATURE_FLAGS.KEY.eq(key.flag().key()))
                    .fetchOne();
        if (row == null) {
            log.warn("feature flag '{}' is not in feature_flags: evaluating as off", key.flag().key());
            return false;
        }
        return row.value2() != null ? row.value2() : row.value1();
    }
}
