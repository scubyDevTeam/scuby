package co.scuby.identity;

import org.jspecify.annotations.Nullable;

/** The contract's `User` (web/src/contracts/session.ts). */
record UserView(String id, String displayName, String email, @Nullable String phone) {
    static UserView of(Person p) {
        return new UserView(p.id().toString(), p.displayName(), p.email(), p.verifiedPhone());
    }
}
