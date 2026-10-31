package co.scuby.cases;

import co.scuby.pets.Pets;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import org.jspecify.annotations.Nullable;

/** GET /feed query (web/src/contracts/feed.ts; missing from openapi.json — reported). */
record FeedQuery(@Nullable Vertical vertical,
                 Pets.@Nullable Species species,
                 @Nullable @DecimalMin("-90") @DecimalMax("90") Double lat,
                 @Nullable @DecimalMin("-180") @DecimalMax("180") Double lng) {}
