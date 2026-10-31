package co.scuby.platform.security;

import org.jspecify.annotations.Nullable;

import java.util.UUID;

/**
 * Who is asking (docs/eng/api.md · Device identity): the signed-in person if any, the device always,
 * and nothing else (no IP is read or stored). A signed-in session wins when both are present.
 */
public record Caller(@Nullable UUID personId, String deviceHash) {

    /** Set by identity's device-cookie filter on every request. */
    public static final String DEVICE_HASH_ATTRIBUTE = "scuby.deviceHash";

    public boolean signedIn() {
        return personId != null;
    }

    /** One key per uploader/reporter: the account when signed in, else the device. */
    public String ownerKey() {
        return personId != null ? "p:" + personId : "d:" + deviceHash;
    }
}
