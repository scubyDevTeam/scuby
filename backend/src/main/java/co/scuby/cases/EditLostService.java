package co.scuby.cases;

import co.scuby.pets.Pets;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;

/**
 * PATCH /lost-cases/{code} (docs/product/04-lost-workflow.md · editing; L1 design §4.1). Order: the case exists → the
 * caller is its owner → the field rules → the photos (outside any transaction: S3 in staging) → active. Then one
 * transaction: the pet's look through Pets, and last, as the guard, the case UPDATE (… AND status = 'active'). Zero rows
 * there is invalid_transition and rolls the pet change back. The case row is held only by that last statement. Never
 * re-broadcasts (decision #27); the place namer is never called (a network call): a moved zone gets the generic label.
 */
@Service
class EditLostService {

    record Target(UUID createdBy, String status, UUID petId, GeoPoint point, List<String> petPhotos) {}

    private final DSLContext db;
    private final Clock clock;
    private final OwnerAccess owners;
    private final Pets pets;
    private final PhotoAttachments photos;
    private final TransactionTemplate tx;

    EditLostService(DSLContext db, Clock clock, OwnerAccess owners, Pets pets, PhotoAttachments photos, TransactionTemplate tx) {
        this.db = db;
        this.clock = clock;
        this.owners = owners;
        this.pets = pets;
        this.photos = photos;
        this.tx = tx;
    }

    void edit(String rawCode, Account account, Caller caller, EditLostRequest body) {
        String code = OwnerAccess.code(rawCode);
        UUID me = account.personId();
        Instant now = clock.instant();
        Target target = owners.require(target(code), Target::createdBy, me);
        Map<String, String> problems = LostEditDerivation.problems(body, now, PublishLostService.CLOCK_DRIFT);
        if (!problems.isEmpty()) throw CaseErrors.invalidFields(problems);
        if (body.photoUrls().isPresent()) {
            photos.requireAttachable(LostEditDerivation.newPhotos(body.photoUrls().value(), target.petPhotos()),
                    UploadPurpose.pet, caller, "photo_urls");
        }
        if (!"active".equals(target.status())) throw CaseErrors.invalidTransition();
        LostEditDerivation.Change change = LostEditDerivation.change(body, target.point());
        if (change.isEmpty()) return;
        tx.executeWithoutResult(status -> {
            if (change.touchesPet()) pets.updateLook(target.petId(), new Pets.LookChange(change.photoUrls(), change.marks()));
            if (updateCase(code, me, change) == 0) throw CaseErrors.invalidTransition();
        });
    }

    private Optional<Target> target(String code) {
        return db.select(LOST_CASE.CREATED_BY, LOST_CASE.STATUS, LOST_CASE.PET_ID, LOST_CASE.LAST_SEEN_LAT, LOST_CASE.LAST_SEEN_LNG, PET.PHOTO_URLS)
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new Target(r.get(LOST_CASE.CREATED_BY), r.get(LOST_CASE.STATUS), r.get(LOST_CASE.PET_ID),
                         new GeoPoint(r.get(LOST_CASE.LAST_SEEN_LAT), r.get(LOST_CASE.LAST_SEEN_LNG)), Arrays.asList(r.get(PET.PHOTO_URLS))));
    }

    /** The case's sent fields, guarded by owner and active; SET status = status when only pet fields were sent. */
    private int updateCase(String code, UUID me, LostEditDerivation.Change change) {
        Map<Field<?>, Object> set = new LinkedHashMap<>();
        if (change.point() != null) {
            set.put(LOST_CASE.LAST_SEEN_LAT, change.point().lat());
            set.put(LOST_CASE.LAST_SEEN_LNG, change.point().lng());
            set.put(LOST_CASE.LAST_SEEN_PUBLIC_LAT, change.publicPoint().lat());
            set.put(LOST_CASE.LAST_SEEN_PUBLIC_LNG, change.publicPoint().lng());
            set.put(LOST_CASE.PLACE_NAME, null);
        }
        if (change.radiusM() != null) set.put(LOST_CASE.LAST_SEEN_RADIUS_M, change.radiusM());
        if (change.lastSeenAt() != null) set.put(LOST_CASE.LAST_SEEN_AT, change.lastSeenAt().atOffset(ZoneOffset.UTC));
        if (set.isEmpty()) set.put(LOST_CASE.STATUS, LOST_CASE.STATUS);
        return db.update(LOST_CASE).set(set)
                 .where(LOST_CASE.CODE.eq(code), LOST_CASE.CREATED_BY.eq(me), LOST_CASE.STATUS.eq(DSL.inline("active")))
                 .execute();
    }
}
