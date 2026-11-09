package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.db.Spatial;
import co.scuby.platform.security.Caller;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.SIGHTING;

@Component
class SightingQueries {

    record CaseForSighting(String status, Instant lastSeenAt, double distanceM) {}

    private final DSLContext db;

    SightingQueries(DSLContext db) {
        this.db = db;
    }

    /** The case and the point's distance from its SNAPPED public center (decision 69), on geography (meters). */
    Optional<CaseForSighting> caseFor(String code, GeoPoint point) {
        var distance = Spatial.distanceMeters(LOST_CASE.LAST_SEEN_PUBLIC_POINT, Spatial.geography(point));
        return db.select(LOST_CASE.STATUS, LOST_CASE.LAST_SEEN_AT, distance)
                 .from(LOST_CASE).where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new CaseForSighting(r.value1(), r.value2().toInstant(), r.value3()));
    }

    /** The case's status, or empty when it no longer exists. */
    Optional<String> status(String code) {
        return db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> r.value1());
    }

    Optional<UUID> replay(String code, String clientId) {
        return db.select(SIGHTING.ID).from(SIGHTING)
                 .where(SIGHTING.CASE_CODE.eq(code)).and(SIGHTING.CLIENT_ID.eq(clientId))
                 .fetchOptional(r -> r.value1());
    }

    /**
     * One conditional statement: the sighting is inserted only while the case exists and is active (the status is an
     * inline literal in the SELECT, no lock: a close that commits a moment later simply ordered after this sighting).
     * ON CONFLICT on the replay key: a concurrent retry of the same client_id gets the first row's id.
     * Empty when the case is not active any more (or gone) and the call is not a replay.
     */
    Optional<UUID> insertIfActive(String code, GeoPoint point, Instant seenAt, Instant now, @Nullable String note, List<String> photos,
                                  Caller caller, @Nullable String contactPhone, @Nullable String clientId) {
        UUID newId = UUID.randomUUID();
        Optional<UUID> id = db.insertInto(SIGHTING, SIGHTING.ID, SIGHTING.CASE_CODE, SIGHTING.LAT, SIGHTING.LNG, SIGHTING.SEEN_AT,
                        SIGHTING.CREATED_AT, SIGHTING.NOTE, SIGHTING.PHOTO_URLS, SIGHTING.REPORTER_PERSON_ID,
                        SIGHTING.REPORTER_DEVICE_HASH, SIGHTING.CONTACT_PHONE, SIGHTING.CLIENT_ID)
                .select(db.select(DSL.val(newId, SIGHTING.ID), LOST_CASE.CODE, DSL.val(point.lat(), SIGHTING.LAT), DSL.val(point.lng(), SIGHTING.LNG),
                                  DSL.val(seenAt.atOffset(ZoneOffset.UTC), SIGHTING.SEEN_AT), DSL.val(now.atOffset(ZoneOffset.UTC), SIGHTING.CREATED_AT),
                                  DSL.val(note, SIGHTING.NOTE), DSL.val(photos.toArray(String[]::new), SIGHTING.PHOTO_URLS),
                                  DSL.val(caller.personId(), SIGHTING.REPORTER_PERSON_ID), DSL.val(caller.deviceHash(), SIGHTING.REPORTER_DEVICE_HASH),
                                  DSL.val(contactPhone, SIGHTING.CONTACT_PHONE), DSL.val(clientId, SIGHTING.CLIENT_ID))
                         .from(LOST_CASE)
                         .where(LOST_CASE.CODE.eq(code), LOST_CASE.STATUS.eq(DSL.inline("active"))))
                .onConflict(SIGHTING.CASE_CODE, SIGHTING.CLIENT_ID).doNothing()
                .returning(SIGHTING.ID)
                .fetchOptional(r -> r.get(SIGHTING.ID));
        if (id.isPresent() || clientId == null) return id;
        return replay(code, clientId);          // lost the replay-key race: the winner's row
    }

    /** The reporter's pin with what correction and delete classify: its status, age and reporter, its case's status and time. */
    record OwnPin(String status, Instant createdAt, @Nullable UUID reporterPersonId, String reporterDeviceHash,
                  String caseStatus, Instant lastSeenAt, @Nullable Double distanceM) {}

    /**
     * One read: the pin on this case, joined to its case, and — when the body carries a usable point — that point's
     * distance from the case's SNAPPED public center (decision #69), never from the exact point.
     */
    Optional<OwnPin> ownPin(String code, UUID id, @Nullable GeoPoint point) {
        Field<Double> distance = point == null
                ? DSL.inline((Double) null, SQLDataType.DOUBLE).as("distance_m")
                : Spatial.distanceMeters(LOST_CASE.LAST_SEEN_PUBLIC_POINT, Spatial.geography(point)).as("distance_m");
        return db.select(SIGHTING.STATUS, SIGHTING.CREATED_AT, SIGHTING.REPORTER_PERSON_ID, SIGHTING.REPORTER_DEVICE_HASH,
                         LOST_CASE.STATUS, LOST_CASE.LAST_SEEN_AT, distance)
                 .from(SIGHTING).join(LOST_CASE).on(LOST_CASE.CODE.eq(SIGHTING.CASE_CODE))
                 .where(SIGHTING.ID.eq(id), SIGHTING.CASE_CODE.eq(code))
                 .fetchOptional(r -> new OwnPin(r.value1(), r.value2().toInstant(), r.value3(), r.value4(), r.value5(),
                         r.value6().toInstant(), r.value7()));
    }

    /**
     * "Mine" in SQL, as LostCaseDerivation.mine: the caller's person, or a pin with no person from the caller's device
     * (docs/eng/api.md · Device identity). Another person's pin never matches, whatever device sent it.
     */
    private static Condition reportedBy(Caller caller) {
        Condition anonymousFromThisDevice = SIGHTING.REPORTER_PERSON_ID.isNull().and(SIGHTING.REPORTER_DEVICE_HASH.eq(caller.deviceHash()));
        return caller.personId() == null
                ? anonymousFromThisDevice
                : SIGHTING.REPORTER_PERSON_ID.eq(caller.personId()).or(anonymousFromThisDevice);
    }

    /** Visible and inside the 15-minute window: created_at > now − 15 min (exclusive, as LostCaseDerivation.editable). */
    private static Condition stillEditable(Instant now) {
        return SIGHTING.STATUS.eq(DSL.inline("visible"))
                .and(SIGHTING.CREATED_AT.gt(now.minus(LostCaseDerivation.EDIT_WINDOW).atOffset(ZoneOffset.UTC)));
    }

    /** Moves the pin, its time and note; photos, contact and created_at stay. The guard repeats every check, the case's status included. */
    boolean correct(String code, UUID id, Caller caller, GeoPoint point, Instant seenAt, @Nullable String note, Instant now) {
        return db.update(SIGHTING)
                 .set(SIGHTING.LAT, point.lat())
                 .set(SIGHTING.LNG, point.lng())
                 .set(SIGHTING.SEEN_AT, seenAt.atOffset(ZoneOffset.UTC))
                 .set(SIGHTING.NOTE, note)
                 .where(SIGHTING.ID.eq(id), SIGHTING.CASE_CODE.eq(code), stillEditable(now), reportedBy(caller),
                        DSL.exists(DSL.selectOne().from(LOST_CASE)
                                .where(LOST_CASE.CODE.eq(code), LOST_CASE.STATUS.eq(DSL.inline("active")))))
                 .execute() == 1;
    }

    /** Delete is a status: the row and its (case_code, client_id) replay key stay. No case-status guard (spec §4.8). */
    boolean deleteOwn(String code, UUID id, Caller caller, Instant now) {
        return db.update(SIGHTING)
                 .set(SIGHTING.STATUS, DSL.inline("deleted_by_reporter"))
                 .where(SIGHTING.ID.eq(id), SIGHTING.CASE_CODE.eq(code), stillEditable(now), reportedBy(caller))
                 .execute() == 1;
    }
}
