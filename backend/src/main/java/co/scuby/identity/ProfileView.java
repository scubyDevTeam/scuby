package co.scuby.identity;

import org.jspecify.annotations.Nullable;

/** The contract's `Profile` (web/src/contracts/session.ts). */
record ProfileView(String displayName, String email, @Nullable String phone, @Nullable String city,
                   @Nullable String bio, NotificationPrefs notificationPrefs, @Nullable String photoUrl) {

    record NotificationPrefs(boolean lost, boolean found, boolean adoption, boolean help) {}

    static ProfileView of(Person p) {
        return new ProfileView(p.displayName(), p.email(), p.verifiedPhone(), p.city(), p.bio(),
                new NotificationPrefs(p.notifyLost(), p.notifyFound(), p.notifyAdoption(), p.notifyHelp()),
                p.photoUrl());
    }
}
