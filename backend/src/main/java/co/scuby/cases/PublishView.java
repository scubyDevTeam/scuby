package co.scuby.cases;

/** The contract's Publish union: `{phone_step: "otp"}` or `{code}`. */
final class PublishView {

    private PublishView() {}

    record PhoneStep(String phoneStep) {
        static final PhoneStep OTP = new PhoneStep("otp");
    }

    record Published(String code) {}
}
