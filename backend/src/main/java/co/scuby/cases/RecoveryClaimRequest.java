package co.scuby.cases;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;

import java.util.List;

/**
 * RecoveryClaimRequest (web/src/contracts/actions.ts). phone is required (absent = a Jackson error; null and a number that
 * is not a supported mobile are validation_failed {phone}); photo_urls ≤ 5, stored and not exposed (O36); from_sighting_id
 * links the claim to the caller's own recent visible pin on this case when it is one, and is ignored otherwise (a plain
 * string in the contract: never a field error). Bound without @Valid: the order of spec §4.9 decides.
 */
record RecoveryClaimRequest(@JsonProperty(required = true) @Nullable String phone,
                            @Nullable @Size(max = 5) List<@NotBlank String> photoUrls,
                            @Nullable String fromSightingId) {

    List<String> photos() {
        return photoUrls == null ? List.of() : photoUrls;
    }
}
