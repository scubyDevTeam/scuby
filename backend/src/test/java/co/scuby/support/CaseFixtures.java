package co.scuby.support;

import co.scuby.cases.LocationPrecisionDerivation;
import co.scuby.platform.db.GeoPoint;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.PURGED_CASE_CODE;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;
import static co.scuby.db.generated.Tables.SIGHTING;

/** Seeds cases and sightings directly (the endpoints that write them have their own tests). */
public final class CaseFixtures {

    /** Medellín, the mock's DEFAULT_CENTER; Luna's radius is 100 m like the mock's fixture. */
    public static final GeoPoint MEDELLIN = new GeoPoint(6.2442, -75.5812);
    public static final String LUNA_PHONE = "+573114829017";

    private final DSLContext db;

    CaseFixtures(DSLContext db) {
        this.db = db;
    }

    public String luna(UUID owner) {
        return lostCase(owner, "7K3PQ", "Luna", "dog", MEDELLIN, 100, "active",
                MutableClock.START.minusSeconds(2 * 86_400));
    }

    public String lostCase(UUID owner, String code, String petName, String species, GeoPoint at, double radiusM,
                           String status, Instant publishedAt) {
        return lostCase(owner, code, petName, species, at, radiusM, status, publishedAt, true);
    }

    /** As above, with the publisher's number flagged as on WhatsApp or not. */
    public String lostCase(UUID owner, String code, String petName, String species, GeoPoint at, double radiusM,
                           String status, Instant publishedAt, boolean phoneHasWhatsapp) {
        return lostCase(owner, code, petName, species, at, radiusM, status, publishedAt, phoneHasWhatsapp, true);
    }

    /** As above, with the number verified by SMS code at publish or not (publisher_phone_otp off: stored unverified). */
    public String lostCase(UUID owner, String code, String petName, String species, GeoPoint at, double radiusM,
                           String status, Instant publishedAt, boolean phoneHasWhatsapp, boolean phoneVerified) {
        GeoPoint publicAt = LocationPrecisionDerivation.publicCenter(at);
        UUID pet = UUID.randomUUID();
        db.insertInto(PET).set(PET.ID, pet).set(PET.NAME, petName).set(PET.SPECIES, species)
          .set(PET.SIZE, "small").set(PET.COLORS, new String[]{"black", "tan"})
          .set(PET.PHOTO_URLS, new String[]{"http://localhost/dev-media/" + "a".repeat(64) + ".jpg"})
          .set(PET.CUSTODY_STATE, "claimed").set(PET.CREATED_AT, publishedAt.atOffset(ZoneOffset.UTC)).execute();
        db.insertInto(RESPONSIBILITY_LINK).set(RESPONSIBILITY_LINK.ID, UUID.randomUUID())
          .set(RESPONSIBILITY_LINK.PERSON_ID, owner).set(RESPONSIBILITY_LINK.PET_ID, pet)
          .set(RESPONSIBILITY_LINK.ROLE, "owner").set(RESPONSIBILITY_LINK.ACTIVE_FROM, publishedAt.atOffset(ZoneOffset.UTC)).execute();
        db.insertInto(LOST_CASE)
          .set(LOST_CASE.CODE, code).set(LOST_CASE.PET_ID, pet).set(LOST_CASE.CREATED_BY, owner)
          .set(LOST_CASE.STATUS, status).set(LOST_CASE.PUBLISHED_AT, publishedAt.atOffset(ZoneOffset.UTC))
          .set(LOST_CASE.RESOLVED_AT, "active".equals(status) ? null : publishedAt.plusSeconds(86_400).atOffset(ZoneOffset.UTC))
          .set(LOST_CASE.CONTACT_PHONE, LUNA_PHONE).set(LOST_CASE.CONTACT_PHONE_VERIFIED, phoneVerified).set(LOST_CASE.PHONE_HAS_WHATSAPP, phoneHasWhatsapp)
          .set(LOST_CASE.EXPOSE_WHATSAPP, true).set(LOST_CASE.EXPOSE_EMAIL, false).set(LOST_CASE.IN_APP_ONLY, false)
          .set(LOST_CASE.LAST_SEEN_LAT, at.lat()).set(LOST_CASE.LAST_SEEN_LNG, at.lng())
          .set(LOST_CASE.LAST_SEEN_PUBLIC_LAT, publicAt.lat()).set(LOST_CASE.LAST_SEEN_PUBLIC_LNG, publicAt.lng())
          .set(LOST_CASE.LAST_SEEN_RADIUS_M, radiusM).set(LOST_CASE.LAST_SEEN_AT, publishedAt.atOffset(ZoneOffset.UTC))
          .execute();
        return code;
    }

    public UUID sighting(String code, GeoPoint at, Instant seenAt, Instant createdAt, @Nullable UUID reporterPerson,
                         String reporterDeviceHash, @Nullable String contactPhone, String status) {
        UUID id = UUID.randomUUID();
        db.insertInto(SIGHTING)
          .set(SIGHTING.ID, id).set(SIGHTING.CASE_CODE, code)
          .set(SIGHTING.LAT, at.lat()).set(SIGHTING.LNG, at.lng())
          .set(SIGHTING.SEEN_AT, seenAt.atOffset(ZoneOffset.UTC)).set(SIGHTING.CREATED_AT, createdAt.atOffset(ZoneOffset.UTC))
          .set(SIGHTING.REPORTER_PERSON_ID, reporterPerson).set(SIGHTING.REPORTER_DEVICE_HASH, reporterDeviceHash)
          .set(SIGHTING.CONTACT_PHONE, contactPhone)
          .set(SIGHTING.STATUS, status)
          .execute();
        return id;
    }

    /** The pet a case was published for. */
    public UUID petOf(String code) {
        return db.select(LOST_CASE.PET_ID).from(LOST_CASE).where(LOST_CASE.CODE.eq(code)).fetchOne(LOST_CASE.PET_ID);
    }

    /** Closes a case as expiry or an earlier close left it: status and resolved_at set, resolution left NULL. */
    public void close(String code, String status, Instant resolvedAt) {
        db.update(LOST_CASE).set(LOST_CASE.STATUS, status).set(LOST_CASE.RESOLVED_AT, resolvedAt.atOffset(ZoneOffset.UTC))
          .where(LOST_CASE.CODE.eq(code)).execute();
    }

    /** Another case for an existing pet, at Medellín, 300 m; the pet's owner link is not touched. */
    public String lostCaseForPet(UUID owner, UUID pet, String code, String status, Instant publishedAt) {
        GeoPoint publicAt = LocationPrecisionDerivation.publicCenter(MEDELLIN);
        db.insertInto(LOST_CASE)
          .set(LOST_CASE.CODE, code).set(LOST_CASE.PET_ID, pet).set(LOST_CASE.CREATED_BY, owner)
          .set(LOST_CASE.STATUS, status).set(LOST_CASE.PUBLISHED_AT, publishedAt.atOffset(ZoneOffset.UTC))
          .set(LOST_CASE.RESOLVED_AT, "active".equals(status) ? null : publishedAt.plusSeconds(86_400).atOffset(ZoneOffset.UTC))
          .set(LOST_CASE.CONTACT_PHONE, LUNA_PHONE).set(LOST_CASE.CONTACT_PHONE_VERIFIED, true).set(LOST_CASE.PHONE_HAS_WHATSAPP, true)
          .set(LOST_CASE.EXPOSE_WHATSAPP, true).set(LOST_CASE.EXPOSE_EMAIL, false).set(LOST_CASE.IN_APP_ONLY, false)
          .set(LOST_CASE.LAST_SEEN_LAT, MEDELLIN.lat()).set(LOST_CASE.LAST_SEEN_LNG, MEDELLIN.lng())
          .set(LOST_CASE.LAST_SEEN_PUBLIC_LAT, publicAt.lat()).set(LOST_CASE.LAST_SEEN_PUBLIC_LNG, publicAt.lng())
          .set(LOST_CASE.LAST_SEEN_RADIUS_M, 300.0).set(LOST_CASE.LAST_SEEN_AT, publishedAt.atOffset(ZoneOffset.UTC))
          .execute();
        return code;
    }

    public void purge(String code) {
        db.insertInto(PURGED_CASE_CODE).set(PURGED_CASE_CODE.CODE, code)
          .set(PURGED_CASE_CODE.PURGED_AT, MutableClock.START.atOffset(ZoneOffset.UTC)).execute();
    }

    /** A recovery claim as «Lo tengo» stores it, never repeated (last active when made); answered an hour after it was made unless it is open. */
    public UUID claim(String code, UUID claimant, String phone, Instant createdAt, String status) {
        return claim(code, claimant, phone, createdAt, createdAt, status);
    }

    /** As above, with the claimant's last «Lo tengo» on it at {@code lastActiveAt} (a repeat refreshed it). */
    public UUID claim(String code, UUID claimant, String phone, Instant createdAt, Instant lastActiveAt, String status) {
        UUID id = UUID.randomUUID();
        db.insertInto(RECOVERY_CLAIM)
          .set(RECOVERY_CLAIM.ID, id).set(RECOVERY_CLAIM.CASE_CODE, code).set(RECOVERY_CLAIM.CLAIMANT_PERSON_ID, claimant)
          .set(RECOVERY_CLAIM.PHONE, phone).set(RECOVERY_CLAIM.STATUS, status)
          .set(RECOVERY_CLAIM.CREATED_AT, createdAt.atOffset(ZoneOffset.UTC))
          .set(RECOVERY_CLAIM.LAST_ACTIVE_AT, lastActiveAt.atOffset(ZoneOffset.UTC))
          .set(RECOVERY_CLAIM.ANSWERED_AT, "open".equals(status) ? null : createdAt.plusSeconds(3600).atOffset(ZoneOffset.UTC))
          .execute();
        return id;
    }

    /** A dog owned by {@code owner}, with no case (name may be null: a found animal's pet has none). */
    public UUID ownedPet(UUID owner, @Nullable String name, Instant createdAt) {
        UUID pet = UUID.randomUUID();
        db.insertInto(PET).set(PET.ID, pet).set(PET.NAME, name).set(PET.SPECIES, "dog").set(PET.SIZE, (String) null)
          .set(PET.CUSTODY_STATE, "claimed").set(PET.CREATED_AT, createdAt.atOffset(ZoneOffset.UTC)).execute();
        db.insertInto(RESPONSIBILITY_LINK).set(RESPONSIBILITY_LINK.ID, UUID.randomUUID())
          .set(RESPONSIBILITY_LINK.PERSON_ID, owner).set(RESPONSIBILITY_LINK.PET_ID, pet)
          .set(RESPONSIBILITY_LINK.ROLE, "owner").set(RESPONSIBILITY_LINK.ACTIVE_FROM, createdAt.atOffset(ZoneOffset.UTC)).execute();
        return pet;
    }

    /** Ends the pet's active owner link. */
    public void unlink(UUID pet, Instant at) {
        db.update(RESPONSIBILITY_LINK).set(RESPONSIBILITY_LINK.ACTIVE_TO, at.atOffset(ZoneOffset.UTC))
          .where(RESPONSIBILITY_LINK.PET_ID.eq(pet), RESPONSIBILITY_LINK.ACTIVE_TO.isNull()).execute();
    }
}
