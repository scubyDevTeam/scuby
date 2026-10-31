package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * What the database says about a lost case, loaded according to the viewer's access. The publisher's
 * number is present only when it is public (whatsappPhone): a private number is never loaded.
 */
record LostCaseFacts(String code, String status, @Nullable Instant resolvedAt, UUID createdBy, PetFacts pet,
                     GeoPoint center, double radiusM, Instant lastSeenAt, @Nullable String placeName,
                     String publisherName, @Nullable String whatsappPhone, List<SightingFacts> sightings) {

    record PetFacts(@Nullable String name, String species, @Nullable String size, List<String> colors,
                    @Nullable String marks, List<String> photoUrls) {}

    record SightingFacts(UUID id, GeoPoint point, Instant seenAt, Instant createdAt, @Nullable String note,
                         List<String> photoUrls, @Nullable UUID reporterPersonId, String reporterDeviceHash,
                         @Nullable String contactPhone, boolean hidden, boolean highlighted) {}

    LostCaseFacts withSightings(List<SightingFacts> loaded) {
        return new LostCaseFacts(code, status, resolvedAt, createdBy, pet, center, radiusM, lastSeenAt, placeName,
                publisherName, whatsappPhone, List.copyOf(loaded));
    }
}
