package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.db.Spatial;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Select;
import org.jooq.SelectConditionStep;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.SIGHTING;

/** The feed in one query per branch; per-row sighting counts are correlated subqueries on sighting_by_case_recent_idx. */
@Component
class FeedQueries {

    private final DSLContext db;

    FeedQueries(DSLContext db) {
        this.db = db;
    }

    private static final Field<Integer> SIGHTINGS = DSL.field(DSL.selectCount().from(SIGHTING)
            .where(SIGHTING.CASE_CODE.eq(LOST_CASE.CODE)).and(SIGHTING.STATUS.eq(DSL.inline("visible")))).as("sightings_count");
    private static final Field<OffsetDateTime> LAST_SIGHTING = DSL.field(DSL.select(DSL.max(SIGHTING.SEEN_AT)).from(SIGHTING)
            .where(SIGHTING.CASE_CODE.eq(LOST_CASE.CODE)).and(SIGHTING.STATUS.eq(DSL.inline("visible")))).as("last_sighting_at");

    Select<? extends Record> localQuery(GeoPoint near, @Nullable String species, double radiusM, int limit) {
        Field<Double> distance = Spatial.distanceMeters(LOST_CASE.LAST_SEEN_POINT, Spatial.geography(near));
        Field<Integer> band = DSL.when(distance.le(2_000.0), 0).when(distance.le(5_000.0), 1)
                                 .when(distance.le(10_000.0), 2).otherwise(3);
        return base(species)
                .and(Spatial.withinMeters(LOST_CASE.LAST_SEEN_POINT, Spatial.geography(near), radiusM))
                .orderBy(band, LOST_CASE.PUBLISHED_AT.desc(), LOST_CASE.CODE)
                .limit(limit);
    }

    Select<? extends Record> nationalQuery(@Nullable String species, int limit) {
        return base(species).orderBy(LOST_CASE.PUBLISHED_AT.desc(), LOST_CASE.CODE).limit(limit);
    }

    List<FeedRow> fetch(Select<? extends Record> query) {
        return query.fetch(r -> new FeedRow(
                r.get(LOST_CASE.CODE), r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE),
                Arrays.asList(r.get(PET.COLORS)),
                r.get(PET.PHOTO_URLS).length == 0 ? null : r.get(PET.PHOTO_URLS)[0],
                r.get(LOST_CASE.PLACE_NAME), new GeoPoint(r.get(LOST_CASE.LAST_SEEN_LAT), r.get(LOST_CASE.LAST_SEEN_LNG)),
                r.get(LOST_CASE.LAST_SEEN_AT).toInstant(), r.get(SIGHTINGS),
                r.get(LAST_SIGHTING) == null ? null : r.get(LAST_SIGHTING).toInstant()));
    }

    private SelectConditionStep<Record> base(@Nullable String species) {
        Condition speciesFilter = species == null ? DSL.noCondition() : PET.SPECIES.eq(species);
        return db.select(List.of(LOST_CASE.CODE, LOST_CASE.PLACE_NAME, LOST_CASE.LAST_SEEN_LAT, LOST_CASE.LAST_SEEN_LNG,
                         LOST_CASE.LAST_SEEN_AT, PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.PHOTO_URLS,
                         SIGHTINGS, LAST_SIGHTING))
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 // Inline literal: a bind parameter here would make the partial indexes (WHERE status = 'active')
                 // unusable under pgjdbc's generic prepared plans (backend/CLAUDE.md · Migrations and indexes).
                 .where(LOST_CASE.STATUS.eq(DSL.inline("active"))).and(speciesFilter);
    }
}
