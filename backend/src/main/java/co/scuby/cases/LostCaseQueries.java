package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.PURGED_CASE_CODE;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static co.scuby.db.generated.Tables.SIGHTING;

/** Reads for GET /cases/{code}: one query for the case, one for its sightings — never one per sighting. */
@Component
class LostCaseQueries {

    private final DSLContext db;

    LostCaseQueries(DSLContext db) {
        this.db = db;
    }

    /**
     * THE public-contact rule, written once (a privacy rule: it decides whether a person's number becomes public): the
     * publisher's number only when it is exposed, on WhatsApp, not «only in the app», and verified by SMS code (with the
     * publisher_phone_otp flag off a case is published with the number unverified, and that is never public). The case
     * status is left out on purpose: a claim may reactivate an expired case and the link is computed after that.
     * Otherwise NULL, never loaded. Every reader of the number goes through this field or {@link #WHATSAPP_PHONE}.
     */
    static final Field<String> CONTACT_IF_PUBLIC = DSL.when(
            DSL.condition(LOST_CASE.EXPOSE_WHATSAPP).and(LOST_CASE.PHONE_HAS_WHATSAPP).and(LOST_CASE.CONTACT_PHONE_VERIFIED).and(LOST_CASE.IN_APP_ONLY.isFalse()),
            LOST_CASE.CONTACT_PHONE);

    /** The case page's number: {@link #CONTACT_IF_PUBLIC} while the case is active; NULL once it is closed. */
    static final Field<String> WHATSAPP_PHONE = DSL.when(LOST_CASE.STATUS.eq(DSL.inline("active")), CONTACT_IF_PUBLIC).as("whatsapp_phone");

    /** The publisher's name only when they chose it; a name derived from the email is never loaded for display (review I3). */
    static final Field<String> PUBLISHER_NAME = DSL.when(DSL.condition(PERSON.DISPLAY_NAME_CHOSEN), PERSON.DISPLAY_NAME).as("publisher_name");

    Optional<LostCaseFacts> loadCase(String code) {
        return db.select(LOST_CASE.CODE, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT, LOST_CASE.CREATED_BY,
                         LOST_CASE.LAST_SEEN_LAT, LOST_CASE.LAST_SEEN_LNG, LOST_CASE.LAST_SEEN_RADIUS_M, LOST_CASE.LAST_SEEN_AT,
                         LOST_CASE.PLACE_NAME, WHATSAPP_PHONE,
                         PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.MARKS, PET.PHOTO_URLS, PUBLISHER_NAME)
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
                         r.get(LOST_CASE.PLACE_NAME), r.get(PUBLISHER_NAME), r.get(WHATSAPP_PHONE), List.of(), null));
    }

    boolean isPurged(String code) {
        return db.fetchExists(PURGED_CASE_CODE, PURGED_CASE_CODE.CODE.eq(code));
    }

    /** A case shows at most this many sightings: the most recent ones (docs/product/04 · display rules, decision 64). */
    static final int MAX_SIGHTINGS_SHOWN = 200;

    List<LostCaseFacts.SightingFacts> sightings(String code, Access access) {
        return sightingsQuery(code, access).fetch(LostCaseQueries::toSighting);
    }

    /**
     * The {@link #MAX_SIGHTINGS_SHOWN} most recent sightings the viewer may see (newest first; the derivation puts them
     * back oldest first). PUBLIC: only visible pins are queried, and reporters' numbers are selected as NULL; OWNER: visible and hidden pins (never moderated or deleted ones).
     */
    Select<? extends Record> sightingsQuery(String code, Access access) {
        var phone = access == Access.OWNER ? SIGHTING.CONTACT_PHONE : DSL.castNull(SIGHTING.CONTACT_PHONE).as(SIGHTING.CONTACT_PHONE.getName());
        // Inline literals. Moderated and reporter-deleted pins reach nobody, the owner included (L1 design §2.2).
        var visibility = access == Access.OWNER
                ? SIGHTING.STATUS.in(DSL.inline("visible"), DSL.inline("hidden_by_owner"))
                : SIGHTING.STATUS.eq("visible");
        return db.select(SIGHTING.ID, SIGHTING.LAT, SIGHTING.LNG, SIGHTING.SEEN_AT, SIGHTING.CREATED_AT, SIGHTING.NOTE,
                         SIGHTING.PHOTO_URLS, SIGHTING.REPORTER_PERSON_ID, SIGHTING.REPORTER_DEVICE_HASH, phone,
                         SIGHTING.STATUS, SIGHTING.HIGHLIGHTED_BY_OWNER)
                 .from(SIGHTING)
                 .where(SIGHTING.CASE_CODE.eq(code)).and(visibility)
                 .orderBy(SIGHTING.SEEN_AT.desc(), SIGHTING.ID.desc())
                 .limit(MAX_SIGHTINGS_SHOWN);
    }

    private static LostCaseFacts.SightingFacts toSighting(Record r) {
        return new LostCaseFacts.SightingFacts(r.get(SIGHTING.ID), new GeoPoint(r.get(SIGHTING.LAT), r.get(SIGHTING.LNG)),
                r.get(SIGHTING.SEEN_AT).toInstant(), r.get(SIGHTING.CREATED_AT).toInstant(), r.get(SIGHTING.NOTE),
                Arrays.asList(r.get(SIGHTING.PHOTO_URLS)), r.get(SIGHTING.REPORTER_PERSON_ID),
                r.get(SIGHTING.REPORTER_DEVICE_HASH), r.get(SIGHTING.CONTACT_PHONE.getName(), String.class),
                !"visible".equals(r.get(SIGHTING.STATUS)), r.get(SIGHTING.HIGHLIGHTED_BY_OWNER));
    }

    /**
     * The owner's claim list shows at most this many: the newest by each claim's last activity (decision 18; L1 design §4.13). Accepted
     * limit: with more than 50 newer claims, an older open claim (a refreshed claim moves up, decision 18) is counted in open_claim_count but not listed. Realistic only under spam; ordering open claims first
     * would lose the index order, so measure the plan before changing it.
     */
    static final int MAX_CLAIMS_SHOWN = 50;

    /**
     * The owner's claims in one query: the newest MAX_CLAIMS_SHOWN of every status, newest first, each row carrying the count
     * of open, non-stale claims of the whole case. That filtered window (not a total) is the one thing the contract needs
     * beyond the page: open_claim_count must cover claims past the 50th, and a second statement would break the owner's
     * ceiling of 4. Non-stale is last_active_at >= now - 7 d (inclusive; ClaimDerivation.STALE_AFTER, pinned by ClaimLeakTest).
     * Read through the case_code prefix of recovery_claim_one_per_claimant (RecoveryClaimPlanTest). Owner only: CaseReads never calls it for anyone else.
     */
    Select<? extends Record> claimsQuery(String code, Instant now) {
        Field<Integer> openNonStale = DSL.count()
                .filterWhere(RECOVERY_CLAIM.STATUS.eq(DSL.inline("open"))
                        .and(RECOVERY_CLAIM.LAST_ACTIVE_AT.ge(ClaimDerivation.staleCutoff(now).atOffset(ZoneOffset.UTC))))
                .over().as("open_non_stale");
        return db.select(RECOVERY_CLAIM.ID, RECOVERY_CLAIM.PHONE, RECOVERY_CLAIM.CREATED_AT, RECOVERY_CLAIM.LAST_ACTIVE_AT,
                         RECOVERY_CLAIM.STATUS, openNonStale)
                 .from(RECOVERY_CLAIM)
                 .where(RECOVERY_CLAIM.CASE_CODE.eq(code))
                 .orderBy(RECOVERY_CLAIM.LAST_ACTIVE_AT.desc(), RECOVERY_CLAIM.ID.desc())
                 .limit(MAX_CLAIMS_SHOWN);
    }

    LostCaseFacts.ClaimFacts claims(String code, Instant now) {
        var rows = claimsQuery(code, now).fetch();
        int open = rows.isEmpty() ? 0 : rows.getFirst().get("open_non_stale", Integer.class);
        return new LostCaseFacts.ClaimFacts(rows.map(r -> new LostCaseFacts.ClaimRow(r.get(RECOVERY_CLAIM.ID), r.get(RECOVERY_CLAIM.PHONE),
                r.get(RECOVERY_CLAIM.CREATED_AT).toInstant(), r.get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant(), r.get(RECOVERY_CLAIM.STATUS))), open);
    }
}
