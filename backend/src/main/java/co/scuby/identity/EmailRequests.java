package co.scuby.identity;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** EmailStartRequest / EmailVerifyRequest (web/src/contracts/session.ts). */
final class EmailRequests {

    static final String EMAIL = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

    /** RFC 5321 path limit. */
    static final int MAX_LENGTH = 254;

    private EmailRequests() {}

    record Start(@NotNull @Size(max = MAX_LENGTH) @Pattern(regexp = EMAIL) String email) {}

    record Verify(@NotNull @Size(max = MAX_LENGTH) @Pattern(regexp = EMAIL) String email, @NotNull @Pattern(regexp = "^\\d{6}$") String code) {}
}
