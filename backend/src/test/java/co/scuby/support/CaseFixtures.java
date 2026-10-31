package co.scuby.support;

import co.scuby.platform.db.GeoPoint;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.PURGED_CASE_CODE;
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

    public void purge(String code) {
        db.insertInto(PURGED_CASE_CODE).set(PURGED_CASE_CODE.CODE, code)
          .set(PURGED_CASE_CODE.PURGED_AT, MutableClock.START.atOffset(ZoneOffset.UTC)).execute();
    }
}
