package co.scuby.uploads;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

/** UploadRequest (web/src/contracts/actions.ts). */
record UploadRequest(@NotNull UploadPurpose purpose,
                     @NotNull @Pattern(regexp = "^[0-9a-f]{64}$") String sha256,
                     @NotNull @Pattern(regexp = "^image/jpeg$") String contentType,
                     @NotNull @Positive @Max(10_000_000) Long bytes) {}
