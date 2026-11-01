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
                        @Nullable String otherActiveCode, boolean superseded) {}

    private static final LostCase OTHER = LOST_CASE.as("other");

    /** The code of another active case of the same pet, if any (the active_case_exists pre-check); a scalar subquery on LOST_CASE. */
    static final Field<String> OTHER_ACTIVE_CODE = DSL.field(DSL.select(OTHER.CODE).from(OTHER)
            .where(OTHER.PET_ID.eq(LOST_CASE.PET_ID), OTHER.STATUS.eq(DSL.inline("active")), OTHER.CODE.ne(LOST_CASE.CODE)))
            .as("other_active_code");

    /**
     * The one definition of «a newer case of the same pet exists» (decision #81): newest is the latest published_at, the
     * higher code on a tie. Only the newest case of a pet can be reopened, reactivated by a claim or offered by /me/pets, so
     * a share link to an older search never revives it. The alias is "newer"; {@code c} is the case being judged.
     */
    static Condition superseded(LostCase c) {
        LostCase newer = LOST_CASE.as("newer");
        return DSL.exists(DSL.selectOne().from(newer).where(newer.PET_ID.eq(c.PET_ID),
                newer.PUBLISHED_AT.gt(c.PUBLISHED_AT).or(newer.PUBLISHED_AT.eq(c.PUBLISHED_AT).and(newer.CODE.gt(c.CODE)))));
    }

    private final DSLContext db;

    LifecycleQueries(DSLContext db) {
        this.db = db;
    }

    /** The case, and the code of another active case of the same pet, if any (the active_case_exists pre-check). */
    Optional<LifecycleRow> load(String code) {
        Field<String> other = OTHER_ACTIVE_CODE;
        Field<Boolean> superseded = DSL.field(superseded(LOST_CASE)).as("superseded");
        return db.select(LOST_CASE.CODE, LOST_CASE.CREATED_BY, LOST_CASE.PET_ID, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT, other, superseded)
                 .from(LOST_CASE).where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new LifecycleRow(r.get(LOST_CASE.CODE), r.get(LOST_CASE.CREATED_BY), r.get(LOST_CASE.PET_ID),
                         r.get(LOST_CASE.STATUS), r.get(LOST_CASE.RESOLVED_AT) == null ? null : r.get(LOST_CASE.RESOLVED_AT).toInstant(),
                         r.get(other), r.get(superseded)));
    }

    /** Reunite (from active or expired, decision 17) or cancel (from active): only the owner. False when the guard did not hold (the race loser). */
    boolean close(String code, UUID owner, String status, String resolution, @Nullable String attribution, Instant now) {
        var from = "reunited".equals(status) ? LOST_CASE.STATUS.in(DSL.inline("active"), DSL.inline("expired")) : LOST_CASE.STATUS.eq(DSL.inline("active"));
        return db.update(LOST_CASE)
                 .set(LOST_CASE.STATUS, DSL.inline(status))
                 .set(LOST_CASE.RESOLUTION, resolution)
                 .set(LOST_CASE.RESOLUTION_ATTRIBUTION, attribution)
                 .set(LOST_CASE.RESOLVED_AT, now.atOffset(ZoneOffset.UTC))
                 .where(LOST_CASE.CODE.eq(code), LOST_CASE.CREATED_BY.eq(owner), from)
                 .execute() == 1;
    }

    /**
     * Back to active: from expired, inside the reopen window, only while it is the pet's newest case, and only while the pet has no other active case. With
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
                        LOST_CASE.RESOLVED_AT.ge(LostLifecycleDerivation.reopenCutoff(now).atOffset(ZoneOffset.UTC)), superseded(LOST_CASE).not(),
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
