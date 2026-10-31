package co.scuby.cases;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;

import java.time.OffsetDateTime;
import java.util.List;

/** SightingRequest (web/src/contracts/actions.ts). photo_urls defaults to []. */
record SightingRequest(@NotNull @Valid PointInput point,
                       @NotNull OffsetDateTime seenAt,
                       @Nullable @Size(max = 500) String note,
                       @Nullable @Size(max = 3) List<@NotBlank String> photoUrls,
                       @Nullable @Pattern(regexp = "^\\+[1-9]\\d{6,14}$") String contactPhone,
                       @Nullable @Size(min = 8, max = 64) String clientId) {

    List<String> photos() {
        return photoUrls == null ? List.of() : photoUrls;
    }
}
