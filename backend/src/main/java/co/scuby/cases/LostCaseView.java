package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;

/** The contract's LostCase (web/src/contracts/case.ts). Every field present; null where the viewer may not see. */
record LostCaseView(String code, String vertical, String status, @Nullable Instant resolvedAt, String viewer,
                    PetView pet, LastSeenView lastSeen, int openClaimCount, List<SightingView> sightings,
                    List<Object> claims, @Nullable Object pendingCheckin, @Nullable ContactView contact) {

    record PetView(String name, String species, @Nullable String size, List<String> colors, @Nullable String marks,
                   List<String> photoUrls) {}

    record LastSeenView(GeoPoint center, double radiusM, Instant at, String placeName) {}

    record SightingView(String id, GeoPoint point, Instant seenAt, @Nullable String note, List<String> photoUrls,
                        String source, boolean highlightedByOwner, @Nullable String contactPhone, boolean hidden,
                        boolean mine, @Nullable Instant editableUntil) {}

    record ContactView(String displayName, @Nullable String whatsappUrl) {}
}
