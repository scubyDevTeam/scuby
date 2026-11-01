package co.scuby.cases;

import co.scuby.platform.web.CodePoints;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.jspecify.annotations.Nullable;

import java.time.OffsetDateTime;

/**
 * SightingCorrectionRequest (web/src/contracts/actions.ts). All three required (absent = a Jackson error before any lookup);
 * point and seen_at not null and note ≤ 500 are checked by BodyValidation after the pin, owner and case checks (spec §4.7).
 */
record SightingCorrectionRequest(@JsonProperty(required = true) @NotNull @Valid PointInput point,
                                 @JsonProperty(required = true) @NotNull OffsetDateTime seenAt,
                                 @JsonProperty(required = true) @Nullable @CodePoints(max = 500) String note) {}
