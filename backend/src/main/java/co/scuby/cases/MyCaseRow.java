package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;

/** One of the caller's cases as «Mis casos» needs it. */
record MyCaseRow(String code, String status, Instant publishedAt, @Nullable String placeName, @Nullable String petName,
                 String species, @Nullable String size, List<String> colors, @Nullable String firstPhotoUrl) {}
