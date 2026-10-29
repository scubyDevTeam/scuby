package co.scuby.identity;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static co.scuby.identity.PhoneStepDerivation.Step;
import static org.assertj.core.api.Assertions.assertThat;

/** docs/eng/auth.md · Phone, and the design's "Phone step at publish". Human review: this table is the rule. */
class PhoneStepDerivationTest {

    @ParameterizedTest(name = "otp={0} stored={1} verified={2} target={3} code={4} → {5}")
    @CsvSource(nullValues = "null", value = {
            // flag on
            "true,  +573001111111, true,  +573001111111, false, USE_VERIFIED",     // later publish, same verified number
            "true,  +573001111111, true,  +573001111111, true,  USE_VERIFIED",     // a stray code is ignored
            "true,  null,          false, +573001111111, false, SEND_CODE",        // first publish
            "true,  null,          false, +573001111111, true,  CHECK_CODE",
            "true,  +573001111111, true,  +573002222222, false, SEND_CODE",        // «cambiar»: verification belongs to the number
            "true,  +573001111111, true,  +573002222222, true,  CHECK_CODE",
            "true,  +573001111111, false, +573001111111, false, SEND_CODE",        // stored but unverified (stricter than the mock)
            "true,  +573001111111, false, +573001111111, true,  CHECK_CODE",
            "true,  +573001111111, false, +573002222222, false, SEND_CODE",
            // flag off
            "false, null,          false, +573001111111, false, STORE_UNVERIFIED",
            "false, null,          false, +573001111111, true,  STORE_UNVERIFIED",
            "false, +573001111111, true,  +573001111111, false, USE_VERIFIED",     // a verified number stays verified
            "false, +573001111111, true,  +573002222222, false, STORE_UNVERIFIED",
            "false, +573001111111, false, +573001111111, false, STORE_UNVERIFIED",
            "false, +573001111111, false, +573002222222, true,  STORE_UNVERIFIED",
    })
    void decides(boolean otpOn, String stored, boolean verified, String target, boolean codeGiven, Step expected) {
        assertThat(PhoneStepDerivation.decide(otpOn, stored, verified, target, codeGiven)).isEqualTo(expected);
    }
}
