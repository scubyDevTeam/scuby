package co.scuby.identity;

import org.jspecify.annotations.Nullable;

/** The publish phone step as a pure decision (docs/eng/auth.md · Phone; design · Phone step at publish). */
final class PhoneStepDerivation {

    enum Step { USE_VERIFIED, SEND_CODE, CHECK_CODE, STORE_UNVERIFIED }

    private PhoneStepDerivation() {}

    static Step decide(boolean otpOn, @Nullable String storedPhone, boolean storedVerified, String target, boolean codeGiven) {
        if (storedVerified && target.equals(storedPhone)) return Step.USE_VERIFIED;
        if (!otpOn) return Step.STORE_UNVERIFIED;
        return codeGiven ? Step.CHECK_CODE : Step.SEND_CODE;
    }
}
