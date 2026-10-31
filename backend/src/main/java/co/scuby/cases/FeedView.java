package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;

/** The contract's Feed (web/src/contracts/feed.ts). */
record FeedView(String scope, List<FeedItem> items) {

    record FeedItem(String code, String vertical, String title, String species, @Nullable String summary,
                    String placeName, GeoPoint point, @Nullable String photoUrl, Instant happenedAt,
                    boolean possibleFind, @Nullable Integer sightingsCount, @Nullable Instant lastSightingAt,
                    @Nullable String detail) {}
}
