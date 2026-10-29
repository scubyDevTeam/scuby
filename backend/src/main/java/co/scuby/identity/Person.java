package co.scuby.identity;

import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.UUID;

record Person(UUID id, String displayName, String email, @Nullable String googleSub, @Nullable Boolean googleEmailAuthoritative,
              @Nullable String phone, @Nullable Instant phoneVerifiedAt,
              @Nullable String city, @Nullable String bio,
              boolean notifyLost, boolean notifyFound, boolean notifyAdoption, boolean notifyHelp,
              @Nullable String photoUrl) {

    /** The contract's `phone`: the publisher's verified number, null until one is verified. */
    @Nullable String verifiedPhone() {
        return phoneVerifiedAt != null ? phone : null;
    }
}
