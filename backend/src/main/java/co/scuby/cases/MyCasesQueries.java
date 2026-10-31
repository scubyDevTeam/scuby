package co.scuby.cases;

import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.Select;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;

/** The caller's cases in one query (any status, newest first). */
@Component
class MyCasesQueries {

    private final DSLContext db;

    MyCasesQueries(DSLContext db) {
        this.db = db;
    }

    Select<? extends Record> query(UUID personId) {
        return db.select(LOST_CASE.CODE, LOST_CASE.STATUS, LOST_CASE.PUBLISHED_AT, LOST_CASE.PLACE_NAME,
                         PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.PHOTO_URLS)
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .where(LOST_CASE.CREATED_BY.eq(personId))
                 .orderBy(LOST_CASE.PUBLISHED_AT.desc(), LOST_CASE.CODE);
    }

    List<MyCaseRow> fetch(UUID personId) {
        return query(personId).fetch(r -> new MyCaseRow(
                r.get(LOST_CASE.CODE), r.get(LOST_CASE.STATUS), r.get(LOST_CASE.PUBLISHED_AT).toInstant(),
                r.get(LOST_CASE.PLACE_NAME), r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE),
                Arrays.asList(r.get(PET.COLORS)),
                r.get(PET.PHOTO_URLS).length == 0 ? null : r.get(PET.PHOTO_URLS)[0]));
    }
}
