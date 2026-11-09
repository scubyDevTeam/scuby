package co.scuby.cases;

import co.scuby.identity.PhoneNumbers;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.BodyValidation;
import co.scuby.platform.web.ErrorCode;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * «Lo vi». The checks read and call S3 (photos) first; the write is one conditional INSERT ... SELECT that only
 * succeeds while the case is active, so a sighting never lands on a case closed or purged in between and no
 * transaction or lock is needed. There are no rate limits here: they are deferred until real patterns are
 * seen (docs/product/00-product-map.md, decision log; docs/open-items.md).
 */
@Service
class SightingService {

    private final SightingQueries queries;
    private final PhoneNumbers phones;
    private final PhotoAttachments photos;
    private final Clock clock;
    private final BodyValidation validation;

    SightingService(SightingQueries queries, PhoneNumbers phones, PhotoAttachments photos,
                    Clock clock, BodyValidation validation) {
        this.queries = queries;
        this.phones = phones;
        this.photos = photos;
        this.clock = clock;
        this.validation = validation;
    }

    public UUID report(String rawCode, SightingRequest request, Caller caller) {
        String code = CaseCodes.normalize(rawCode).orElseThrow(SightingService::notFound);
        GeoPoint point = request.point().toGeoPoint();
        SightingQueries.CaseForSighting found = queries.caseFor(code, point).orElseThrow(SightingService::notFound);
        if (request.clientId() != null) {
            Optional<UUID> replayed = queries.replay(code, request.clientId());
            if (replayed.isPresent()) return replayed.get();
        }
        if (!"active".equals(found.status())) throw new ApiException(ErrorCode.INVALID_TRANSITION, "the case is not active");

        Instant now = clock.instant();
        Instant seenAt = request.seenAt().toInstant();
        SightingRulesDerivation.check(seenAt, now, found.lastSeenAt(), found.distanceM()).ifPresent(refusal -> {
            throw new ApiException(ErrorCode.valueOf(refusal.name()), refusal.name().toLowerCase());
        });
        String contact = request.contactPhone() == null ? null : phones.requireMobile(request.contactPhone(), "contact_phone");
        photos.requireAttachable(request.photos(), UploadPurpose.sighting, caller, "photo_urls");

        // The case may have closed or been purged since the read above: the insert re-checks it in the same statement.
        return queries.insertIfActive(code, point, seenAt, now, request.note(), request.photos(), caller, contact, request.clientId())
                      .orElseGet(() -> {
                          queries.status(code).orElseThrow(SightingService::notFound);
                          throw new ApiException(ErrorCode.INVALID_TRANSITION, "the case is not active");
                      });
    }

    /**
     * «Corregir» (L1 design §4.7). Order: the pin is on this case and not moderated or deleted (not_found) → mine, visible,
     * inside the window (forbidden) → the case is active (invalid_transition) → the fields → the «Lo vi» rules, the
     * distance from the snapped center. One conditional UPDATE repeats every guard; zero rows → re-read and re-classify.
     */
    public void correct(String rawCode, String rawId, Caller caller, SightingCorrectionRequest body) {
        String code = OwnerAccess.code(rawCode);
        UUID id = OwnerAccess.id(rawId).orElseThrow(SightingService::noSuchSighting);
        Instant now = clock.instant();
        SightingQueries.OwnPin pin = queries.ownPin(code, id, usable(body.point())).orElseThrow(SightingService::noSuchSighting);
        classify(pin, caller, now, true);
        validation.require(body);
        Instant seenAt = body.seenAt().toInstant();
        SightingRulesDerivation.check(seenAt, now, pin.lastSeenAt(), pin.distanceM()).ifPresent(refusal -> {
            throw new ApiException(ErrorCode.valueOf(refusal.name()), refusal.name().toLowerCase());
        });
        if (queries.correct(code, id, caller, body.point().toGeoPoint(), seenAt, body.note(), now)) return;
        classify(queries.ownPin(code, id, null).orElseThrow(SightingService::noSuchSighting), caller, now, true);
        throw new ApiException(ErrorCode.INVALID_TRANSITION, "the case is not active");
    }

    /**
     * «Borrar» (L1 design §4.8): as correct without the case-status check; a status, never a hard delete. Idempotent: the
     * caller's own pin already deleted_by_reporter answers 204 again with no write (a retry after a lost response, or a
     * double tap whose first delete won the race); someone else's deleted pin stays not_found.
     */
    public void delete(String rawCode, String rawId, Caller caller) {
        String code = OwnerAccess.code(rawCode);
        UUID id = OwnerAccess.id(rawId).orElseThrow(SightingService::noSuchSighting);
        Instant now = clock.instant();
        SightingQueries.OwnPin pin = queries.ownPin(code, id, null).orElseThrow(SightingService::noSuchSighting);
        if (deletedByCaller(pin, caller)) return;
        classify(pin, caller, now, false);
        if (queries.deleteOwn(code, id, caller, now)) return;
        SightingQueries.OwnPin after = queries.ownPin(code, id, null).orElseThrow(SightingService::noSuchSighting);
        if (deletedByCaller(after, caller)) return;
        classify(after, caller, now, false);
        throw new ApiException(ErrorCode.FORBIDDEN, "this pin can no longer be deleted");
    }

    /** Already in the delete's target state, and the caller's: nothing to do. */
    private static boolean deletedByCaller(SightingQueries.OwnPin pin, Caller caller) {
        return "deleted_by_reporter".equals(pin.status())
                && LostCaseDerivation.mine(caller.personId(), caller.deviceHash(), pin.reporterPersonId(), pin.reporterDeviceHash());
    }

    private static void classify(SightingQueries.OwnPin pin, Caller caller, Instant now, boolean needsActiveCase) {
        if ("removed_by_moderation".equals(pin.status()) || "deleted_by_reporter".equals(pin.status())) throw noSuchSighting();
        boolean mine = LostCaseDerivation.mine(caller.personId(), caller.deviceHash(), pin.reporterPersonId(), pin.reporterDeviceHash());
        if (!LostCaseDerivation.editable(mine, "visible".equals(pin.status()), pin.createdAt(), now)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "only its reporter, while it is visible and inside its 15 minutes");
        }
        if (needsActiveCase && !"active".equals(pin.caseStatus())) {
            throw new ApiException(ErrorCode.INVALID_TRANSITION, "the case is not active");
        }
    }

    /** A point good enough to measure (the field rules refuse the others later, in their order). */
    private static @Nullable GeoPoint usable(@Nullable PointInput p) {
        if (p == null || p.lat() == null || p.lng() == null) return null;
        if (p.lat() < -90 || p.lat() > 90 || p.lng() < -180 || p.lng() > 180) return null;
        return p.toGeoPoint();
    }

    private static ApiException noSuchSighting() {
        return new ApiException(ErrorCode.NOT_FOUND, "no such sighting");
    }

    private static ApiException notFound() {
        return new ApiException(ErrorCode.NOT_FOUND, "no such case");
    }
}
