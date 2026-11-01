package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;

/**
 * GET /me/pets (spec §4.11) runs on every publish pet picker and every «Mis mascotas» view. 20,000 pets of 1,000 owners:
 * a person's links must be found by person, not by scanning every link (responsibility_link_one_active_owner leads with
 * pet_id and cannot serve a lookup by person).
 */
@IntegrationTest
class MyPetsPlanTest {

    static final UUID OWNER_7 = UUID.fromString("00000000-0000-0000-0004-000000000007");

    @Autowired DSLContext db;

    @BeforeEach
    void setUp() {
        SeedVolume.petsOwnedBy(db, 1_000, 20_000);
    }

    @Test
    void aPersonsPetsAreFoundThroughTheActiveByPersonIndex() {
        var q = myPets(OWNER_7);
        PlanAssert.assertUsesIndex(db, q, "responsibility_link_by_person_active_idx");
        PlanAssert.assertNoSeqScan(db, q, "responsibility_link");
    }

    /** The query exactly as spec §4.11 writes it. Task 12 replaces this method with MyPetsQueries.query. */
    private Select<?> myPets(UUID me) {
        var cutoff = MutableClock.START.minus(Duration.ofDays(30)).atOffset(ZoneOffset.UTC);
        var lastActivity = DSL.max(DSL.greatest(LOST_CASE.PUBLISHED_AT, LOST_CASE.RESOLVED_AT));
        return db.select(PET.ID, PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.MARKS, PET.PHOTO_URLS, PET.CREATED_AT,
                         DSL.max(LOST_CASE.CODE).filterWhere(LOST_CASE.STATUS.eq(DSL.inline("active"))).as("active_case_code"),
                         DSL.arrayAgg(LOST_CASE.CODE).orderBy(LOST_CASE.RESOLVED_AT.desc())
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
}
