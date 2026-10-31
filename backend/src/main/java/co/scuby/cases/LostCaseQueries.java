package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.PURGED_CASE_CODE;
import static co.scuby.db.generated.Tables.SIGHTING;

/** Reads for GET /cases/{code}: one query for the case, one for its sightings — never one per sighting. */
@Component
class LostCaseQueries {

    private final DSLContext db;

    LostCaseQueries(DSLContext db) {
        this.db = db;
    }

    /**
     * The publisher's number only when it is public: active, exposed, on WhatsApp, and verified by SMS code (with the
     * publisher_phone_otp flag off a case is published with the number unverified, and that is never public).
     * Otherwise NULL — never loaded.
     */
    static final Field<String> WHATSAPP_PHONE = DSL.when(
                    DSL.condition(LOST_CASE.EXPOSE_WHATSAPP).and(LOST_CASE.PHONE_HAS_WHATSAPP).and(LOST_CASE.CONTACT_PHONE_VERIFIED).and(LOST_CASE.STATUS.eq(DSL.inline("active"))),
                    LOST_CASE.CONTACT_PHONE)
            .as("whatsapp_phone");

    Optional<LostCaseFacts> loadCase(String code) {
        return db.select(LOST_CASE.CODE, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT, LOST_CASE.CREATED_BY,
                         LOST_CASE.LAST_SEEN_LAT, LOST_CASE.LAST_SEEN_LNG, LOST_CASE.LAST_SEEN_RADIUS_M, LOST_CASE.LAST_SEEN_AT,
                         LOST_CASE.PLACE_NAME, WHATSAPP_PHONE,
                         PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.MARKS, PET.PHOTO_URLS, PERSON.DISPLAY_NAME)
                 .from(LOST_CASE)
                 .join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .join(PERSON).on(PERSON.ID.eq(LOST_CASE.CREATED_BY))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new LostCaseFacts(
                         r.get(LOST_CASE.CODE), r.get(LOST_CASE.STATUS),
                         r.get(LOST_CASE.RESOLVED_AT) == null ? null : r.get(LOST_CASE.RESOLVED_AT).toInstant(),
                         r.get(LOST_CASE.CREATED_BY),
                         new LostCaseFacts.PetFacts(r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE),
                                 Arrays.asList(r.get(PET.COLORS)), r.get(PET.MARKS), Arrays.asList(r.get(PET.PHOTO_URLS))),
                         new GeoPoint(r.get(LOST_CASE.LAST_SEEN_LAT), r.get(LOST_CASE.LAST_SEEN_LNG)),
                         r.get(LOST_CASE.LAST_SEEN_RADIUS_M), r.get(LOST_CASE.LAST_SEEN_AT).toInstant(),
                         r.get(LOST_CASE.PLACE_NAME), r.get(PERSON.DISPLAY_NAME), r.get(WHATSAPP_PHONE), List.of()));
    }

    boolean isPurged(String code) {
        return db.fetchExists(PURGED_CASE_CODE, PURGED_CASE_CODE.CODE.eq(code));
    }

    List<LostCaseFacts.SightingFacts> sightings(String code, Access access) {
        return sightingsQuery(code, access).fetch(LostCaseQueries::toSighting);
    }

    /** PUBLIC: hidden and removed pins are not queried, and reporters' numbers are selected as NULL. */
    Select<? extends Record> sightingsQuery(String code, Access access) {
        var phone = access == Access.OWNER ? SIGHTING.CONTACT_PHONE : DSL.castNull(SIGHTING.CONTACT_PHONE).as(SIGHTING.CONTACT_PHONE.getName());
        var visibility = access == Access.OWNER
                ? SIGHTING.STATUS.ne("removed_by_moderation")
                : SIGHTING.STATUS.eq("visible");
        return db.select(SIGHTING.ID, SIGHTING.LAT, SIGHTING.LNG, SIGHTING.SEEN_AT, SIGHTING.CREATED_AT, SIGHTING.NOTE,
                         SIGHTING.PHOTO_URLS, SIGHTING.REPORTER_PERSON_ID, SIGHTING.REPORTER_DEVICE_HASH, phone,
                         SIGHTING.STATUS, SIGHTING.HIGHLIGHTED_BY_OWNER)
                 .from(SIGHTING)
                 .where(SIGHTING.CASE_CODE.eq(code)).and(visibility)
                 .orderBy(SIGHTING.SEEN_AT, SIGHTING.ID);
    }

    private static LostCaseFacts.SightingFacts toSighting(Record r) {
        return new LostCaseFacts.SightingFacts(r.get(SIGHTING.ID), new GeoPoint(r.get(SIGHTING.LAT), r.get(SIGHTING.LNG)),
                r.get(SIGHTING.SEEN_AT).toInstant(), r.get(SIGHTING.CREATED_AT).toInstant(), r.get(SIGHTING.NOTE),
                Arrays.asList(r.get(SIGHTING.PHOTO_URLS)), r.get(SIGHTING.REPORTER_PERSON_ID),
                r.get(SIGHTING.REPORTER_DEVICE_HASH), r.get(SIGHTING.CONTACT_PHONE.getName(), String.class),
                !"visible".equals(r.get(SIGHTING.STATUS)), r.get(SIGHTING.HIGHLIGHTED_BY_OWNER));
    }
}
