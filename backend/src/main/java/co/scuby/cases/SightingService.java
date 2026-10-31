package co.scuby.cases;

import co.scuby.identity.PhoneNumbers;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * «Lo vi». The checks read and call S3 (photos) outside any transaction; only the rate-limit decision
 * and the insert run in one, behind two advisory locks (reporter, then IP — always that order, so
 * two requests can never wait on each other in a cycle). Without the locks, parallel requests from
 * one reporter would each count fewer than the limit and all insert (READ COMMITTED).
 */
@Service
class SightingService {

    private final SightingQueries queries;
    private final PhoneNumbers phones;
    private final PhotoAttachments photos;
    private final SightingProperties properties;
    private final Clock clock;
    private final TransactionTemplate tx;

    SightingService(SightingQueries queries, PhoneNumbers phones, PhotoAttachments photos,
                    SightingProperties properties, Clock clock, TransactionTemplate tx) {
        this.queries = queries;
        this.phones = phones;
        this.photos = photos;
        this.properties = properties;
        this.clock = clock;
        this.tx = tx;
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

        return tx.execute(status -> {
            queries.lockReporterThenIp(caller);   // serialises this reporter's and this IP's count-then-insert
            Instant since = now.minus(Duration.ofHours(24));
            var reporter = queries.reporterCountsQuery(caller, code, since).fetchOne();
            var ip = queries.ipCountsQuery(caller.ipHash(), code, since).fetchOne();
            if (SightingRulesDerivation.limited(new SightingRulesDerivation.Counts(reporter.value1(), reporter.value2()),
                    new SightingRulesDerivation.Counts(ip.value1(), ip.value2()), properties.limits())) {
                throw new ApiException(ErrorCode.RATE_LIMITED, "too many sightings");
            }
            return queries.insert(code, point, seenAt, now, request.note(), request.photos(), caller, contact, request.clientId());
        });
    }

    private static ApiException notFound() {
        return new ApiException(ErrorCode.NOT_FOUND, "no such case");
    }
}
