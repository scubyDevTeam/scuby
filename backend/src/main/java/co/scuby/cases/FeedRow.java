package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;

/** One open lost case as the feed needs it (the facts of a feed item). */
record FeedRow(String code, @Nullable String petName, String species, @Nullable String size, List<String> colors,
               @Nullable String firstPhotoUrl, @Nullable String placeName, GeoPoint center, Instant lastSeenAt,
               int sightingsCount, @Nullable Instant lastSightingAt) {}
