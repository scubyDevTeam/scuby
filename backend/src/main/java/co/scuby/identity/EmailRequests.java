package co.scuby.identity;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** EmailStartRequest / EmailVerifyRequest (web/src/contracts/session.ts). */
final class EmailRequests {

    static final String EMAIL = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

    private EmailRequests() {}

    record Start(@NotNull @Pattern(regexp = EMAIL) String email) {}

    record Verify(@NotNull @Pattern(regexp = EMAIL) String email, @NotNull @Pattern(regexp = "^\\d{6}$") String code) {}
}
