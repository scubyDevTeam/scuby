package co.scuby.platform.flags;

/**
 * The code side of the registry in docs/eng/feature-flags.md: a flag in code but not there is a bug.
 * Seeded global values live only in the feature_flags migration.
 */
public enum Flag {
    PUBLISHER_PHONE_OTP("publisher_phone_otp"),
    REVERSE_GEOCODING("reverse_geocoding");

    private final String key;

    Flag(String key) { this.key = key; }

    public String key() { return key; }
}
