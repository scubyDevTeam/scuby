package co.scuby.identity;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** PhoneStartRequest / PhoneVerifyRequest (web/src/contracts/session.ts). */
final class PhoneRequests {

    static final String E164 = "^\\+[1-9]\\d{6,14}$";

    private PhoneRequests() {}

    record Start(@NotNull @Pattern(regexp = E164) String phone) {}

    record Verify(@NotNull @Pattern(regexp = E164) String phone, @NotNull @Pattern(regexp = "^\\d{6}$") String code) {}
}
