package co.scuby.platform.flags;

/** The code side of the registry in docs/eng/feature-flags.md: a flag in code but not there is a bug. */
public enum Flag {
    PUBLISHER_PHONE_OTP("publisher_phone_otp", true),
    REVERSE_GEOCODING("reverse_geocoding", false);

    private final String key;
    private final boolean defaultEnabled;

    Flag(String key, boolean defaultEnabled) {
        this.key = key;
        this.defaultEnabled = defaultEnabled;
    }

    public String key() { return key; }

    /** The seeded global value (tests restore it between cases). */
    public boolean defaultEnabled() { return defaultEnabled; }
}
