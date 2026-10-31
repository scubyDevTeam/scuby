package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.db.Spatial;
import co.scuby.platform.security.Caller;
import org.jooq.DSLContext;
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

    /** The case and the point's distance from its center, on geography (meters). */
    Optional<CaseForSighting> caseFor(String code, GeoPoint point) {
        var distance = Spatial.distanceMeters(LOST_CASE.LAST_SEEN_POINT, Spatial.geography(point));
        return db.select(LOST_CASE.STATUS, LOST_CASE.LAST_SEEN_AT, distance)
                 .from(LOST_CASE).where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new CaseForSighting(r.value1(), r.value2().toInstant(), r.value3()));
    }

    /** The case's status under a share lock (held to commit): a purge or a close waits for this insert. */
    Optional<String> statusForShare(String code) {
        return db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq(code)).forShare()
                 .fetchOptional(r -> r.value1());
    }

    Optional<UUID> replay(String code, String clientId) {
        return db.select(SIGHTING.ID).from(SIGHTING)
                 .where(SIGHTING.CASE_CODE.eq(code)).and(SIGHTING.CLIENT_ID.eq(clientId))
                 .fetchOptional(r -> r.value1());
    }

    /** ON CONFLICT on the replay key: a concurrent retry of the same client_id gets the first row's id. */
    UUID insert(String code, GeoPoint point, Instant seenAt, Instant now, @Nullable String note, List<String> photos,
                Caller caller, @Nullable String contactPhone, @Nullable String clientId) {
        Optional<UUID> id = db.insertInto(SIGHTING)
                .set(SIGHTING.ID, UUID.randomUUID())
                .set(SIGHTING.CASE_CODE, code)
                .set(SIGHTING.LAT, point.lat()).set(SIGHTING.LNG, point.lng())
                .set(SIGHTING.SEEN_AT, seenAt.atOffset(ZoneOffset.UTC))
                .set(SIGHTING.CREATED_AT, now.atOffset(ZoneOffset.UTC))
                .set(SIGHTING.NOTE, note)
                .set(SIGHTING.PHOTO_URLS, photos.toArray(String[]::new))
                .set(SIGHTING.REPORTER_PERSON_ID, caller.personId())
                .set(SIGHTING.REPORTER_DEVICE_HASH, caller.deviceHash())
                .set(SIGHTING.CONTACT_PHONE, contactPhone)
                .set(SIGHTING.CLIENT_ID, clientId)
                .onConflict(SIGHTING.CASE_CODE, SIGHTING.CLIENT_ID).doNothing()
                .returning(SIGHTING.ID)
                .fetchOptional(r -> r.get(SIGHTING.ID));
        return id.orElseGet(() -> replay(code, clientId).orElseThrow());
    }
}
