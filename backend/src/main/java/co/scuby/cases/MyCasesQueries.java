package co.scuby.cases;

import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jooq.Record;
import org.jooq.Select;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;

/** The caller's cases in one query (any status, newest first). */
@Component
class MyCasesQueries {

    private final DSLContext db;

    MyCasesQueries(DSLContext db) {
        this.db = db;
    }

    /** Open, non-stale claims of an active case (a correlated count on an index leading with case_code), else 0. The list is the caller's own. */
    static Field<Integer> openClaims(Instant now) {
        return DSL.when(LOST_CASE.STATUS.eq(DSL.inline("active")),
                        DSL.field(DSL.selectCount().from(RECOVERY_CLAIM)
                                .where(RECOVERY_CLAIM.CASE_CODE.eq(LOST_CASE.CODE), RECOVERY_CLAIM.STATUS.eq(DSL.inline("open")),
                                       RECOVERY_CLAIM.LAST_ACTIVE_AT.ge(ClaimDerivation.staleCutoff(now).atOffset(ZoneOffset.UTC)))))
                  .otherwise(DSL.inline(0))
                  .as("open_claim_count");
    }

    Select<? extends Record> query(UUID personId, Instant now) {
        return db.select(LOST_CASE.CODE, LOST_CASE.STATUS, LOST_CASE.PUBLISHED_AT, LOST_CASE.PLACE_NAME,
                         PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.PHOTO_URLS, openClaims(now))
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .where(LOST_CASE.CREATED_BY.eq(personId))
                 .orderBy(LOST_CASE.PUBLISHED_AT.desc(), LOST_CASE.CODE);
    }

    List<MyCaseRow> fetch(UUID personId, Instant now) {
        return query(personId, now).fetch(r -> new MyCaseRow(
                r.get(LOST_CASE.CODE), r.get(LOST_CASE.STATUS), r.get(LOST_CASE.PUBLISHED_AT).toInstant(),
                r.get(LOST_CASE.PLACE_NAME), r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE),
                Arrays.asList(r.get(PET.COLORS)),
                r.get(PET.PHOTO_URLS).length == 0 ? null : r.get(PET.PHOTO_URLS)[0],
                r.get("open_claim_count", Integer.class)));
    }
}
