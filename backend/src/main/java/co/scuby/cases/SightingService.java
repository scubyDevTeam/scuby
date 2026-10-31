package co.scuby.cases;

import co.scuby.identity.PhoneNumbers;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
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

    SightingService(SightingQueries queries, PhoneNumbers phones, PhotoAttachments photos,
                    Clock clock) {
        this.queries = queries;
        this.phones = phones;
        this.photos = photos;
        this.clock = clock;
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

    private static ApiException notFound() {
        return new ApiException(ErrorCode.NOT_FOUND, "no such case");
    }
}
