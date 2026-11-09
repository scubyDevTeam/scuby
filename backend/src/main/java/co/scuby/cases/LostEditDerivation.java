package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.web.Patch;
import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * PATCH /lost-cases/{code} (docs/product/04-lost-workflow.md · editing; L1 design §4.1). Pure. The field rules, and which
 * columns a valid body writes. A point equal to the stored exact point is not a move. A moved point carries its snapped
 * public center (decision #69) and resets the place name to the generic label (the place namer is never called here).
 * There is no lower bound on last_seen_at, and existing sightings are not revalidated.
 */
final class LostEditDerivation {

    static final int MAX_PHOTOS = 6;
    static final int MAX_MARKS = 500;
    static final double MAX_RADIUS_M = 5000;

    /** What a valid body changes. photoUrls/point/radiusM/lastSeenAt null = unchanged; marks keeps its Patch (null clears). */
    record Change(@Nullable List<String> photoUrls, Patch<String> marks, @Nullable GeoPoint point, @Nullable GeoPoint publicPoint,
                  @Nullable Double radiusM, @Nullable Instant lastSeenAt) {

        boolean touchesPet() {
            return photoUrls != null || marks.isPresent();
        }

        boolean isEmpty() {
            return !touchesPet() && point == null && radiusM == null && lastSeenAt == null;
        }
    }

    private LostEditDerivation() {}

    /** Wire field → what is wrong; empty when the body is valid. futureTolerance is PublishLostService.CLOCK_DRIFT. */
    static Map<String, String> problems(EditLostRequest body, Instant now, Duration futureTolerance) {
        Map<String, String> found = new LinkedHashMap<>();
        if (body.photoUrls().isPresent()) {
            List<String> urls = body.photoUrls().value();
            if (urls == null || urls.isEmpty() || urls.size() > MAX_PHOTOS) found.put("photo_urls", "1 to 6 photos");
            else if (urls.stream().anyMatch(u -> u == null || u.isBlank())) found.put("photo_urls", "a photo url is empty");
        }
        String marks = body.marks().value();
        if (marks != null && marks.codePointCount(0, marks.length()) > MAX_MARKS) found.put("marks", "at most 500 characters");
        if (body.lastSeenPoint().isPresent() && !validPoint(body.lastSeenPoint().value())) {
            found.put("last_seen_point", "lat -90..90 and lng -180..180");
        }
        if (body.lastSeenRadiusM().isPresent()) {
            Double r = body.lastSeenRadiusM().value();
            if (r == null || !(r > 0) || r > MAX_RADIUS_M) found.put("last_seen_radius_m", "more than 0 and at most 5000");
        }
        if (body.lastSeenAt().isPresent()) {
            OffsetDateTime at = body.lastSeenAt().value();
            if (at == null) found.put("last_seen_at", "required");
            else if (at.toInstant().isAfter(now.plus(futureTolerance))) found.put("last_seen_at", "in the future");
        }
        return found;
    }

    /** Call only when problems(...) is empty. */
    static Change change(EditLostRequest body, GeoPoint storedPoint) {
        List<String> photos = body.photoUrls().isPresent() ? List.copyOf(body.photoUrls().value()) : null;
        GeoPoint point = null;
        GeoPoint publicPoint = null;
        if (body.lastSeenPoint().isPresent()) {
            GeoPoint sent = body.lastSeenPoint().value().toGeoPoint();
            if (!sent.equals(storedPoint)) {
                point = sent;
                publicPoint = LocationPrecisionDerivation.publicCenter(sent);
            }
        }
        Double radius = body.lastSeenRadiusM().isPresent() ? body.lastSeenRadiusM().value() : null;
        Instant at = body.lastSeenAt().isPresent() ? body.lastSeenAt().value().toInstant() : null;
        return new Change(photos, body.marks(), point, publicPoint, radius, at);
    }

    /** The sent photos the pet does not have yet: only these go through the upload check (spec §4.1, Q-C1). */
    static List<String> newPhotos(List<String> sent, List<String> onPet) {
        return sent.stream().filter(u -> !onPet.contains(u)).distinct().toList();
    }

    private static boolean validPoint(@Nullable PointInput p) {
        return p != null && p.lat() != null && p.lng() != null
                && p.lat() >= -90 && p.lat() <= 90 && p.lng() >= -180 && p.lng() <= 180;
    }
}
