package co.scuby.cases;

import co.scuby.identity.PublisherPhone;
import co.scuby.pets.Pets;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.jooq.DSLContext;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;

/**
 * docs/product/04-lost-workflow.md · Publishing: pet (or reuse), owner link, case — one transaction.
 *
 * <p>Order: (1) checks without I/O, then the read-only checks <b>outside</b> any transaction: the photo check
 * (it may call S3: {@code PhotoAttachments} is {@code Propagation.NEVER}) and, with {@code pet_id}, ownership and the
 * {@code active_case_exists} pre-check; (2) {@code PublisherPhone.prepare}, with no transaction open (it counts a code
 * attempt in its own statement); (3) one transaction that re-checks ownership and the active case and only <b>then</b>
 * calls {@code PublisherPhone.resolve} ({@code Propagation.MANDATORY}: sends the SMS after commit, or consumes the
 * reserved code). It must come after every other validation — a publish refused or rolled back later leaves the code
 * usable. On {@code CodeSent} the transaction commits and no case is written.
 */
@Service
class PublishLostService {

    static final Duration CLOCK_DRIFT = Duration.ofMinutes(5);
    static final int CODE_ATTEMPTS = 3;

    private final DSLContext db;
    private final Clock clock;
    private final Pets pets;
    private final PhotoAttachments photos;
    private final PublisherPhone publisherPhone;
    private final CaseCodes codes;
    private final PlaceNames placeNames;
    private final TransactionTemplate tx;

    PublishLostService(DSLContext db, Clock clock, Pets pets, PhotoAttachments photos,
                       PublisherPhone publisherPhone, CaseCodes codes, PlaceNames placeNames, TransactionTemplate tx) {
        this.db = db;
        this.clock = clock;
        this.pets = pets;
        this.photos = photos;
        this.publisherPhone = publisherPhone;
        this.codes = codes;
        this.placeNames = placeNames;
        this.tx = tx;
    }

    public Object publish(Account account, Caller caller, PublishLostRequest request) {
        UUID me = account.personId();
        Instant now = clock.instant();

        if (request.lastSeenAt().toInstant().isAfter(now.plus(CLOCK_DRIFT))) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "last_seen_at is in the future",
                    Map.of("last_seen_at", "in the future"), Map.of());
        }
        if (request.petId() == null) {
            // Outside any transaction (S3 HeadObject in staging). A new pet has no active case, so the
            // mock's order (pet checks → photos → phone) is unchanged.
            photos.requireAttachable(request.pet().photoUrls(), UploadPurpose.pet, caller, "pet.photo_urls");
        } else {
            // Read-only pre-check, outside the transaction: a blocked publish must not spend a code attempt.
            requireOwnedAndFree(request.petId(), me);
        }
        // No transaction is open here (PublishLostService is not @Transactional): prepare counts a code attempt in
        // its own statement, and a wrong code is invalid_code right now.
        PublisherPhone.Prepared prepared = publisherPhone.prepare(me, request.phone(), request.otpCode());
        return tx.execute(status -> publishInTransaction(me, caller, request, now, prepared));
    }

    private void requireOwnedAndFree(String petId, UUID me) {
        pets.requireOwnedBy(petId, me);
        String open = activeCaseQuery(UUID.fromString(petId)).fetchOptional(Record1::value1).orElse(null);
        if (open != null) throw activeCaseExists(open);
    }

    private Object publishInTransaction(UUID me, Caller caller, PublishLostRequest request, Instant now,
                                        PublisherPhone.Prepared prepared) {
        // Re-check: a concurrent publish may have won since the pre-check.
        if (request.petId() != null) requireOwnedAndFree(request.petId(), me);

        // Last validation step. CodeSent: this transaction commits (the phone_otp row must persist) and no case is
        // inserted. rate_limited and invalid_code propagate (they leave the transaction rollback-only).
        PublisherPhone.Outcome phone = publisherPhone.resolve(prepared, caller);
        if (phone instanceof PublisherPhone.CodeSent) return PublishView.PhoneStep.OTP;
        PublisherPhone.Ready ready = (PublisherPhone.Ready) phone;

        UUID petId = request.petId() != null ? UUID.fromString(request.petId()) : pets.createOwned(me, request.pet().toNewPet());
        GeoPoint point = request.lastSeenPoint().toGeoPoint();
        String placeName = placeNames.forNewCase(point, me);
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        for (int attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
            String code = codes.newCode();
            int inserted = db.insertInto(LOST_CASE)
                    .set(LOST_CASE.CODE, code)
                    .set(LOST_CASE.PET_ID, petId)
                    .set(LOST_CASE.CREATED_BY, me)
                    .set(LOST_CASE.STATUS, "active")
                    .set(LOST_CASE.PUBLISHED_AT, at)
                    .set(LOST_CASE.CONTACT_PHONE, ready.phone())
                    .set(LOST_CASE.PHONE_HAS_WHATSAPP, request.phoneHasWhatsapp())
                    .set(LOST_CASE.EXPOSE_WHATSAPP, request.contactPrefs().exposeWhatsapp())
                    .set(LOST_CASE.EXPOSE_EMAIL, request.contactPrefs().exposeEmail())
                    .set(LOST_CASE.IN_APP_ONLY, request.contactPrefs().inAppOnly())
                    .set(LOST_CASE.LAST_SEEN_LAT, point.lat())
                    .set(LOST_CASE.LAST_SEEN_LNG, point.lng())
                    .set(LOST_CASE.LAST_SEEN_RADIUS_M, request.lastSeenRadiusM())
                    .set(LOST_CASE.LAST_SEEN_AT, request.lastSeenAt().withOffsetSameInstant(ZoneOffset.UTC))
                    .set(LOST_CASE.PLACE_NAME, placeName)
                    .onConflictDoNothing()
                    .execute();
            if (inserted == 1) return new PublishView.Published(code);
            // Nothing inserted: either a concurrent publish won the one-active-case-per-pet race
            // (→ active_case_exists, rolling back the consumed code too), or the code collided
            // between newCode's check and the insert (→ draw another code).
            String open = activeCaseQuery(petId).fetchOptional(Record1::value1).orElse(null);
            if (open != null) throw activeCaseExists(open);
        }
        throw new IllegalStateException("no free case code after " + CODE_ATTEMPTS + " inserts");
    }

    /** The status is an inline literal so the partial index (WHERE status = 'active') stays usable under generic prepared plans. */
    Select<Record1<String>> activeCaseQuery(UUID petId) {
        return db.select(LOST_CASE.CODE).from(LOST_CASE)
                 .where(LOST_CASE.PET_ID.eq(petId)).and(LOST_CASE.STATUS.eq(DSL.inline("active")));
    }

    private static ApiException activeCaseExists(String code) {
        return new ApiException(ErrorCode.ACTIVE_CASE_EXISTS, "the pet already has an active lost case",
                Map.of(), Map.of("case_code", code));
    }
}
