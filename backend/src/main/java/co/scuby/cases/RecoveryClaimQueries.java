package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static co.scuby.db.generated.Tables.SIGHTING;

/** The statements of «Lo tengo». cases is the only writer of recovery_claim. */
@Component
class RecoveryClaimQueries {

    /** The caller's claim on the case, when they have one (at most one: recovery_claim_one_per_claimant). */
    record OwnClaim(UUID id, String status) {}

    /**
     * {@code publicPhone}: the number under the public-contact rule whatever the status (a claim may reactivate the case before
     * the link is built). {@code activePhone}: the same while the case is active (what the case page shows), for an answer that writes nothing.
     */
    record ClaimCase(String code, UUID createdBy, UUID petId, @Nullable String petName, String status, @Nullable Instant resolvedAt,
                     @Nullable String publicPhone, @Nullable String activePhone, @Nullable OwnClaim own) {
        /** The owner already answered the caller's claim on this case: a repeat gets it back untouched (decision #82). */
        boolean answered() {
            return own != null && !"open".equals(own.status());
        }
    }

    record PinForClaim(ClaimDerivation.SightingLink link, GeoPoint point) {}

    /** The number, only under the public-contact rule and whatever the status (the claim may reactivate the case first). */
    private static final Field<String> PUBLIC_PHONE = LostCaseQueries.CONTACT_IF_PUBLIC.as("public_phone");
    private static final Field<String> ACTIVE_PHONE = LostCaseQueries.WHATSAPP_PHONE;

    private final DSLContext db;

    RecoveryClaimQueries(DSLContext db) {
        this.db = db;
    }

    /** The case, the caller's own claim on it (one statement) and the number under the contact rule. */
    Optional<ClaimCase> caseForClaim(String code, UUID claimant) {
        return db.select(LOST_CASE.CODE, LOST_CASE.CREATED_BY, LOST_CASE.PET_ID, PET.NAME, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT,
                         PUBLIC_PHONE, ACTIVE_PHONE, RECOVERY_CLAIM.ID, RECOVERY_CLAIM.STATUS)
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .leftJoin(RECOVERY_CLAIM).on(RECOVERY_CLAIM.CASE_CODE.eq(LOST_CASE.CODE), RECOVERY_CLAIM.CLAIMANT_PERSON_ID.eq(claimant))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new ClaimCase(r.get(LOST_CASE.CODE), r.get(LOST_CASE.CREATED_BY), r.get(LOST_CASE.PET_ID), r.get(PET.NAME),
                         r.get(LOST_CASE.STATUS), r.get(LOST_CASE.RESOLVED_AT) == null ? null : r.get(LOST_CASE.RESOLVED_AT).toInstant(),
                         r.get(PUBLIC_PHONE), r.get(ACTIVE_PHONE),
                         r.get(RECOVERY_CLAIM.ID) == null ? null : new OwnClaim(r.get(RECOVERY_CLAIM.ID), r.get(RECOVERY_CLAIM.STATUS))));
    }

    record AnswerTarget(UUID createdBy, @Nullable UUID claimId, @Nullable String claimStatus) {}

    /** The case's owner and, when it is on this case, the claim and its stored status (one statement). */
    Optional<AnswerTarget> answerTarget(String code, Optional<UUID> claimId) {
        return db.select(LOST_CASE.CREATED_BY, RECOVERY_CLAIM.ID, RECOVERY_CLAIM.STATUS)
                 .from(LOST_CASE)
                 .leftJoin(RECOVERY_CLAIM).on(RECOVERY_CLAIM.CASE_CODE.eq(LOST_CASE.CODE),
                         claimId.map(RECOVERY_CLAIM.ID::eq).orElse(DSL.falseCondition()))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new AnswerTarget(r.value1(), r.value2(), r.value3()));
    }

    /** The answer, unless it is already the stored one (status <> ?): repeating an answer writes nothing. */
    void answer(String code, UUID claimId, String status, Instant now) {
        db.update(RECOVERY_CLAIM)
          .set(RECOVERY_CLAIM.STATUS, status)
          .set(RECOVERY_CLAIM.ANSWERED_AT, now.atOffset(ZoneOffset.UTC))
          .where(RECOVERY_CLAIM.ID.eq(claimId), RECOVERY_CLAIM.CASE_CODE.eq(code), RECOVERY_CLAIM.STATUS.ne(status))
          .execute();
    }

    /** The pin a claim says it grew out of, on this case. */
    Optional<PinForClaim> pin(String code, UUID id) {
        return db.select(SIGHTING.STATUS, SIGHTING.REPORTER_PERSON_ID, SIGHTING.REPORTER_DEVICE_HASH, SIGHTING.CREATED_AT, SIGHTING.LAT, SIGHTING.LNG)
                 .from(SIGHTING).where(SIGHTING.ID.eq(id), SIGHTING.CASE_CODE.eq(code))
                 .fetchOptional(r -> new PinForClaim(
                         new ClaimDerivation.SightingLink(r.value1(), r.value2(), r.value3(), r.value4().toInstant()),
                         new GeoPoint(r.value5(), r.value6())));
    }

    /**
     * One statement (no lock): the claim is written only while the case is active. ON CONFLICT on the unique index (one claim
     * per claimant per case, any status) the caller's claim is refreshed instead, but only while it is open — a stale one
     * included: the repeat's phone and last_active_at = now, and the photos, point and link only when the repeat sends them
     * (empty photos, no point or no link keep the stored ones); its id, created_at and status stay. A claim the owner already
     * answered is never touched (the DO UPDATE's WHERE is false, also when the answer commits between the caller's read and
     * this statement), so there is no second row: the statement returns nothing and the caller hands that claim back. A double
     * tap serializes on the index entry and refreshes the one row. Returns the new or refreshed claim's id; empty when the
     * case is not active or the claim is answered (the caller re-reads to say which), so a claim on a case that is not active
     * is never answered.
     */
    Optional<UUID> upsertIfActive(String code, UUID claimant, String phone, List<String> photos, @Nullable GeoPoint point,
                                  @Nullable UUID fromSighting, Instant now) {
        UUID id = UUID.randomUUID();
        return db.insertInto(RECOVERY_CLAIM, RECOVERY_CLAIM.ID, RECOVERY_CLAIM.CASE_CODE, RECOVERY_CLAIM.CLAIMANT_PERSON_ID,
                         RECOVERY_CLAIM.PHONE, RECOVERY_CLAIM.PHOTO_URLS, RECOVERY_CLAIM.LAT, RECOVERY_CLAIM.LNG,
                         RECOVERY_CLAIM.FROM_SIGHTING_ID, RECOVERY_CLAIM.STATUS, RECOVERY_CLAIM.CREATED_AT, RECOVERY_CLAIM.LAST_ACTIVE_AT)
                 .select(db.select(DSL.val(id, RECOVERY_CLAIM.ID), LOST_CASE.CODE, DSL.val(claimant, RECOVERY_CLAIM.CLAIMANT_PERSON_ID),
                                   DSL.val(phone, RECOVERY_CLAIM.PHONE), DSL.val(photos.toArray(String[]::new), RECOVERY_CLAIM.PHOTO_URLS),
                                   DSL.val(point == null ? null : point.lat(), RECOVERY_CLAIM.LAT),
                                   DSL.val(point == null ? null : point.lng(), RECOVERY_CLAIM.LNG),
                                   DSL.val(fromSighting, RECOVERY_CLAIM.FROM_SIGHTING_ID), DSL.inline("open", RECOVERY_CLAIM.STATUS),
                                   DSL.val(now.atOffset(ZoneOffset.UTC), RECOVERY_CLAIM.CREATED_AT),
                                   DSL.val(now.atOffset(ZoneOffset.UTC), RECOVERY_CLAIM.LAST_ACTIVE_AT))
                           .from(LOST_CASE)
                           .where(LOST_CASE.CODE.eq(code), LOST_CASE.STATUS.eq(DSL.inline("active"))))
                 .onConflict(RECOVERY_CLAIM.CASE_CODE, RECOVERY_CLAIM.CLAIMANT_PERSON_ID)
                 .doUpdate()
                 .set(RECOVERY_CLAIM.PHONE, DSL.excluded(RECOVERY_CLAIM.PHONE))
                 .set(RECOVERY_CLAIM.PHOTO_URLS, DSL.when(DSL.cardinality(DSL.excluded(RECOVERY_CLAIM.PHOTO_URLS)).gt(0),
                         DSL.excluded(RECOVERY_CLAIM.PHOTO_URLS)).otherwise(RECOVERY_CLAIM.PHOTO_URLS))
                 .set(RECOVERY_CLAIM.LAT, DSL.coalesce(DSL.excluded(RECOVERY_CLAIM.LAT), RECOVERY_CLAIM.LAT))
                 .set(RECOVERY_CLAIM.LNG, DSL.coalesce(DSL.excluded(RECOVERY_CLAIM.LNG), RECOVERY_CLAIM.LNG))
                 .set(RECOVERY_CLAIM.FROM_SIGHTING_ID, DSL.coalesce(DSL.excluded(RECOVERY_CLAIM.FROM_SIGHTING_ID), RECOVERY_CLAIM.FROM_SIGHTING_ID))
                 .set(RECOVERY_CLAIM.LAST_ACTIVE_AT, DSL.excluded(RECOVERY_CLAIM.LAST_ACTIVE_AT))
                 .where(RECOVERY_CLAIM.STATUS.eq(DSL.inline("open")))
                 .returning(RECOVERY_CLAIM.ID)
                 .fetchOptional(r -> r.get(RECOVERY_CLAIM.ID));
    }
}
