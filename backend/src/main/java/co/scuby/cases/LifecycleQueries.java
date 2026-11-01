package co.scuby.cases;

import co.scuby.db.generated.tables.LostCase;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;

/**
 * The lifecycle statements of a lost case: a pre-read and one conditional UPDATE per transition (decision #59, no locks).
 * Every status literal is inline: lost_case_one_active_per_pet is partial on status = 'active'.
 */
@Component
class LifecycleQueries {

    static final String ACTIVE_PER_PET = "lost_case_one_active_per_pet";

    record LifecycleRow(String code, UUID createdBy, UUID petId, String status, @Nullable Instant resolvedAt,
                        @Nullable String otherActiveCode) {}

    private static final LostCase OTHER = LOST_CASE.as("other");

    private final DSLContext db;

    LifecycleQueries(DSLContext db) {
        this.db = db;
    }

    /** The case, and the code of another active case of the same pet, if any (the active_case_exists pre-check). */
    Optional<LifecycleRow> load(String code) {
        Field<String> other = DSL.field(DSL.select(OTHER.CODE).from(OTHER)
                .where(OTHER.PET_ID.eq(LOST_CASE.PET_ID), OTHER.STATUS.eq(DSL.inline("active")), OTHER.CODE.ne(LOST_CASE.CODE)))
                .as("other_active_code");
        return db.select(LOST_CASE.CODE, LOST_CASE.CREATED_BY, LOST_CASE.PET_ID, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT, other)
                 .from(LOST_CASE).where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new LifecycleRow(r.get(LOST_CASE.CODE), r.get(LOST_CASE.CREATED_BY), r.get(LOST_CASE.PET_ID),
                         r.get(LOST_CASE.STATUS), r.get(LOST_CASE.RESOLVED_AT) == null ? null : r.get(LOST_CASE.RESOLVED_AT).toInstant(),
                         r.get(other)));
    }

    /** Reunite or cancel: only the owner, only from active. False when the guard did not hold (the race loser). */
    boolean close(String code, UUID owner, String status, String resolution, @Nullable String attribution, Instant now) {
        return db.update(LOST_CASE)
                 .set(LOST_CASE.STATUS, DSL.inline(status))
                 .set(LOST_CASE.RESOLUTION, resolution)
                 .set(LOST_CASE.RESOLUTION_ATTRIBUTION, attribution)
                 .set(LOST_CASE.RESOLVED_AT, now.atOffset(ZoneOffset.UTC))
                 .where(LOST_CASE.CODE.eq(code), LOST_CASE.CREATED_BY.eq(owner), LOST_CASE.STATUS.eq(DSL.inline("active")))
                 .execute() == 1;
    }

    /**
     * Back to active: from expired, inside the reopen window, and only while the pet has no other active case. With
     * owner = null it is a claim's reactivation (decision #29: anyone holding the animal may revive it). A concurrent
     * publish that wins the pet makes this fail on lost_case_one_active_per_pet (caught by the caller).
     */
    boolean reopen(String code, @Nullable UUID owner, Instant now) {
        Condition ownerGuard = owner == null ? DSL.noCondition() : LOST_CASE.CREATED_BY.eq(owner);
        return db.update(LOST_CASE)
                 .set(LOST_CASE.STATUS, DSL.inline("active"))
                 .set(LOST_CASE.RESOLUTION, (String) null)
                 .set(LOST_CASE.RESOLUTION_ATTRIBUTION, (String) null)
                 .set(LOST_CASE.RESOLVED_AT, (java.time.OffsetDateTime) null)
                 .where(LOST_CASE.CODE.eq(code), ownerGuard, LOST_CASE.STATUS.eq(DSL.inline("expired")),
                        LOST_CASE.RESOLVED_AT.ge(LostLifecycleDerivation.reopenCutoff(now).atOffset(ZoneOffset.UTC)),
                        DSL.notExists(DSL.selectOne().from(OTHER)
                                .where(OTHER.PET_ID.eq(LOST_CASE.PET_ID), OTHER.STATUS.eq(DSL.inline("active")))))
                 .execute() == 1;
    }

    Optional<String> activeCodeFor(UUID petId) {
        return db.select(LOST_CASE.CODE).from(LOST_CASE)
                 .where(LOST_CASE.PET_ID.eq(petId), LOST_CASE.STATUS.eq(DSL.inline("active")))
                 .fetchOptional(LOST_CASE.CODE);
    }
}
