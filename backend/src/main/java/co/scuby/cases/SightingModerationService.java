package co.scuby.cases;

import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.SIGHTING;

/**
 * The owner stars a pin or takes it off the public map (docs/product/04-lost-workflow.md · sighting; L1 design §4.6).
 * Order: case not_found → forbidden → the pin is on this case and visible or hidden_by_owner (else not_found: moderated and
 * deleted pins are invisible to the owner) → body. No case-status check. One UPDATE with only the sent flags, guarded by
 * the same status set; repeats are idempotent. Telling the reporter about a highlight is L2.
 */
@Service
class SightingModerationService {

    record Target(UUID createdBy, @Nullable UUID sightingId) {}

    private final DSLContext db;
    private final OwnerAccess owners;

    SightingModerationService(DSLContext db, OwnerAccess owners) {
        this.db = db;
        this.owners = owners;
    }

    CreatedView moderate(String rawCode, String rawSightingId, UUID me, ModerateSightingRequest body) {
        String code = OwnerAccess.code(rawCode);
        Optional<UUID> id = OwnerAccess.id(rawSightingId);
        Target target = owners.require(target(code, id), Target::createdBy, me);
        if (target.sightingId() == null) throw CaseErrors.notFound("sighting");
        Map<String, String> problems = new LinkedHashMap<>();
        if (body.highlighted().isPresent() && body.highlighted().value() == null) problems.put("highlighted", "true or false");
        if (body.hidden().isPresent() && body.hidden().value() == null) problems.put("hidden", "true or false");
        if (!problems.isEmpty()) throw CaseErrors.invalidFields(problems);

        Map<Field<?>, Object> set = new LinkedHashMap<>();
        if (body.highlighted().isPresent()) set.put(SIGHTING.HIGHLIGHTED_BY_OWNER, body.highlighted().value());
        if (body.hidden().isPresent()) set.put(SIGHTING.STATUS, DSL.inline(body.hidden().value() ? "hidden_by_owner" : "visible"));
        if (!set.isEmpty()) {
            int updated = db.update(SIGHTING).set(set)
                            .where(SIGHTING.ID.eq(target.sightingId()), SIGHTING.CASE_CODE.eq(code),
                                   SIGHTING.STATUS.in(DSL.inline("visible"), DSL.inline("hidden_by_owner")))
                            .execute();
            if (updated == 0) throw CaseErrors.notFound("sighting");   // moderated or deleted since the pre-read
        }
        return new CreatedView(target.sightingId().toString());
    }

    /** The case's owner and, when it is this case's and still the owner's to moderate, the pin's id (one statement). */
    private Optional<Target> target(String code, Optional<UUID> id) {
        return db.select(LOST_CASE.CREATED_BY, SIGHTING.ID)
                 .from(LOST_CASE)
                 .leftJoin(SIGHTING).on(SIGHTING.CASE_CODE.eq(LOST_CASE.CODE),
                         id.map(SIGHTING.ID::eq).orElse(DSL.falseCondition()),
                         SIGHTING.STATUS.in(DSL.inline("visible"), DSL.inline("hidden_by_owner")))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new Target(r.get(LOST_CASE.CREATED_BY), r.get(SIGHTING.ID)));
    }
}
