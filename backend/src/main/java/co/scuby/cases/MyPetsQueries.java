package co.scuby.cases;

import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;

/**
 * GET /me/pets in one query (L1 design §4.11): the caller's active owner links, joined to the pet and to the caller's own
 * lost cases of it. Found through responsibility_link_by_person_active_idx (MyPetsPlanTest); active_to IS NULL is a literal
 * predicate (isNull), status and role literals are inline.
 */
@Component
class MyPetsQueries {

    private final DSLContext db;

    MyPetsQueries(DSLContext db) {
        this.db = db;
    }

    Select<? extends Record> query(UUID me, Instant now) {
        OffsetDateTime cutoff = LostLifecycleDerivation.reopenCutoff(now).atOffset(ZoneOffset.UTC);
        Field<OffsetDateTime> lastActivity = DSL.max(DSL.greatest(LOST_CASE.PUBLISHED_AT, LOST_CASE.RESOLVED_AT));
        return db.select(PET.ID, PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.MARKS, PET.PHOTO_URLS, PET.CREATED_AT,
                         DSL.max(LOST_CASE.CODE).filterWhere(LOST_CASE.STATUS.eq(DSL.inline("active"))).as("active_case_code"),
                         DSL.arrayAgg(LOST_CASE.CODE).orderBy(LOST_CASE.RESOLVED_AT.desc(), LOST_CASE.CODE.desc())
                            .filterWhere(LOST_CASE.STATUS.eq(DSL.inline("expired")).and(LOST_CASE.RESOLVED_AT.ge(cutoff)))
                            .as("reopenable_codes"),
                         lastActivity.as("last_activity"))
                 .from(RESPONSIBILITY_LINK)
                 .join(PET).on(PET.ID.eq(RESPONSIBILITY_LINK.PET_ID))
                 .leftJoin(LOST_CASE).on(LOST_CASE.PET_ID.eq(PET.ID), LOST_CASE.CREATED_BY.eq(me))
                 .where(RESPONSIBILITY_LINK.PERSON_ID.eq(me), RESPONSIBILITY_LINK.ROLE.eq(DSL.inline("owner")),
                        RESPONSIBILITY_LINK.ACTIVE_TO.isNull())
                 .groupBy(PET.ID)
                 .orderBy(lastActivity.desc().nullsLast(), PET.CREATED_AT.desc(), PET.ID);
    }

    List<MyPetRow> fetch(UUID me, Instant now) {
        return query(me, now).fetch(r -> {
            String[] reopenable = r.get("reopenable_codes", String[].class);
            return new MyPetRow(r.get(PET.ID), r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE), Arrays.asList(r.get(PET.COLORS)),
                    r.get(PET.MARKS), Arrays.asList(r.get(PET.PHOTO_URLS)), r.get("active_case_code", String.class),
                    reopenable == null || reopenable.length == 0 ? null : reopenable[0]);
        });
    }
}
