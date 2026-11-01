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

    record ClaimCase(String code, UUID createdBy, UUID petId, @Nullable String petName, String status, @Nullable Instant resolvedAt,
                     ClaimDerivation.ContactFlags flags, @Nullable String publicPhone) {}

    record PinForClaim(ClaimDerivation.SightingLink link, GeoPoint point) {}

    /**
     * The publisher's number only when the case's contact preferences make it public — the case status left out on purpose,
     * since a claim may reactivate an expired case and the link is computed after that. A private number is never loaded.
     */
    static final Field<String> PUBLIC_PHONE = DSL.when(DSL.condition(LOST_CASE.EXPOSE_WHATSAPP).and(LOST_CASE.PHONE_HAS_WHATSAPP)
                    .and(LOST_CASE.CONTACT_PHONE_VERIFIED).and(LOST_CASE.IN_APP_ONLY.isFalse()), LOST_CASE.CONTACT_PHONE)
            .as("public_phone");

    private final DSLContext db;

    RecoveryClaimQueries(DSLContext db) {
        this.db = db;
    }

    Optional<ClaimCase> caseForClaim(String code) {
        return db.select(LOST_CASE.CODE, LOST_CASE.CREATED_BY, LOST_CASE.PET_ID, PET.NAME, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT,
                         LOST_CASE.EXPOSE_WHATSAPP, LOST_CASE.PHONE_HAS_WHATSAPP, LOST_CASE.CONTACT_PHONE_VERIFIED, LOST_CASE.IN_APP_ONLY,
                         PUBLIC_PHONE)
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new ClaimCase(r.get(LOST_CASE.CODE), r.get(LOST_CASE.CREATED_BY), r.get(LOST_CASE.PET_ID), r.get(PET.NAME),
                         r.get(LOST_CASE.STATUS), r.get(LOST_CASE.RESOLVED_AT) == null ? null : r.get(LOST_CASE.RESOLVED_AT).toInstant(),
                         new ClaimDerivation.ContactFlags(r.get(LOST_CASE.EXPOSE_WHATSAPP), r.get(LOST_CASE.PHONE_HAS_WHATSAPP),
                                 r.get(LOST_CASE.CONTACT_PHONE_VERIFIED), r.get(LOST_CASE.IN_APP_ONLY)),
                         r.get(PUBLIC_PHONE)));
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
     * One statement (no lock): the claim is written only while the case is active. ON CONFLICT on the partial unique index
     * (one open claim per claimant per case; the predicate is the same inline literal) the caller's open claim — a stale
     * one included — is refreshed instead: the repeat's phone and last_active_at = now, and the photos, point and link only when the repeat sends them (empty photos, no
     * point or no link keep the stored ones); its id,
     * created_at and status stay. A double tap serializes on the index entry and refreshes the one row. Returns the new or
     * refreshed claim's id; empty when the case is not active (the caller re-reads it to say why), so a claim on a case
     * that is not active is never answered.
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
                 .where(RECOVERY_CLAIM.STATUS.eq(DSL.inline("open")))
                 .doUpdate()
                 .set(RECOVERY_CLAIM.PHONE, DSL.excluded(RECOVERY_CLAIM.PHONE))
                 .set(RECOVERY_CLAIM.PHOTO_URLS, DSL.when(DSL.cardinality(DSL.excluded(RECOVERY_CLAIM.PHOTO_URLS)).gt(0),
                         DSL.excluded(RECOVERY_CLAIM.PHOTO_URLS)).otherwise(RECOVERY_CLAIM.PHOTO_URLS))
                 .set(RECOVERY_CLAIM.LAT, DSL.coalesce(DSL.excluded(RECOVERY_CLAIM.LAT), RECOVERY_CLAIM.LAT))
                 .set(RECOVERY_CLAIM.LNG, DSL.coalesce(DSL.excluded(RECOVERY_CLAIM.LNG), RECOVERY_CLAIM.LNG))
                 .set(RECOVERY_CLAIM.FROM_SIGHTING_ID, DSL.coalesce(DSL.excluded(RECOVERY_CLAIM.FROM_SIGHTING_ID), RECOVERY_CLAIM.FROM_SIGHTING_ID))
                 .set(RECOVERY_CLAIM.LAST_ACTIVE_AT, DSL.excluded(RECOVERY_CLAIM.LAST_ACTIVE_AT))
                 .returning(RECOVERY_CLAIM.ID)
                 .fetchOptional(r -> r.get(RECOVERY_CLAIM.ID));
    }
}
