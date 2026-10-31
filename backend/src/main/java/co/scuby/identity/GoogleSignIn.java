package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Optional;

@Service
class GoogleSignIn {

    private static final Logger log = LoggerFactory.getLogger(GoogleSignIn.class);
    static final int MAX_NAME = 80;   // person.display_name CHECK

    private final GoogleIdTokens tokens;
    private final People people;
    private final SignInSessions sessions;

    private final TransactionTemplate tx;

    GoogleSignIn(GoogleIdTokens tokens, People people, SignInSessions sessions, TransactionTemplate tx) {
        this.tx = tx;
        this.tokens = tokens;
        this.people = people;
        this.sessions = sessions;
    }

    /**
     * By `sub`; else the account with the same verified email, linked only if it has no Google identity
     * yet (the identity key is `sub`: a different one never replaces it) AND Google is authoritative for
     * that address (gmail.com, or a Workspace `hd` equal to its domain) — otherwise anyone could register
     * a Google account over someone else's address and take over their Scuby account; else create one
     * (non-authoritative emails may create, flagged so an email-code sign-in can later revoke the link).
     * People.create keeps the row a concurrent sign-in inserted for the same email, so the account we end
     * with is linked with a conditional update and re-checked: exactly one account, and its google_sub is
     * the one that won (ours or an identical racing request's). The resolved row is then locked and its
     * google_sub re-checked, and the session is opened in the same transaction (see {@link EmailSignIn#verify}).
     */
    public SignedIn signIn(String credential, Optional<String> carriedTokenHash) {
        // Verified BEFORE the transaction opens: on a key-cache miss this fetches Google's JWKS over HTTP, and a
        // slow Google must not hold a pooled connection per waiting sign-in.
        GoogleIdentity google = tokens.verify(credential);
        return tx.execute(status -> signIn(google, carriedTokenHash));
    }

    private SignedIn signIn(GoogleIdentity google, Optional<String> carriedTokenHash) {
        Person resolved = resolve(google);
        // Lock the row and look again: an email-code sign-in may have unlinked this identity (and deleted
        // its sessions) between our read and now. Past the lock the link is stable until we commit, and the
        // session is inserted in this same transaction, so a later unlink's deleteAllOf will see it.
        Person account = people.lock(resolved.id());
        if (!google.sub().equals(account.googleSub())) {
            log.warn("Google sign-in refused: account {} is no longer linked to this Google identity", account.id());
            throw new ApiException(ErrorCode.UNAUTHORIZED, "this Google account is no longer linked");
        }
        return new SignedIn(account, sessions.open(account.id(), carriedTokenHash));
    }

    private Person resolve(GoogleIdentity google) {
        return people.byGoogleSub(google.sub()).orElseGet(() -> {
            String email = EmailSignIn.normalize(google.email());
            boolean authoritative = google.emailAuthoritative();
            Person account = people.byEmail(email)
                    .orElseGet(() -> people.create(email, displayName(google, email), googleName(google).isPresent(), google.sub(), authoritative));
            if (google.sub().equals(account.googleSub())) return account;
            if (account.googleSub() != null) {
                log.warn("Google sign-in refused: account {} is linked to another Google identity", account.id());
                throw new ApiException(ErrorCode.UNAUTHORIZED, "this account is linked to another Google account");
            }
            if (!authoritative) {
                log.warn("Google sign-in refused: account {} exists and Google is not authoritative for its email", account.id());
                throw new ApiException(ErrorCode.UNAUTHORIZED, "this account must be signed into with its email code first");
            }
            if (people.linkGoogle(account.id(), google.sub(), true)) return people.get(account.id());
            Person current = people.get(account.id());                       // lost a race: fine if the winner is us
            if (google.sub().equals(current.googleSub())) return current;
            log.warn("Google sign-in refused: account {} is linked to another Google identity", account.id());
            throw new ApiException(ErrorCode.UNAUTHORIZED, "this account is linked to another Google account");
        });
    }

    /** Google's own name for the person, cleaned and cut to the column's length; empty when Google sent none. */
    private static java.util.Optional<String> googleName(GoogleIdentity google) {
        String name = google.name() == null ? "" : stripInvisible(google.name()).strip();
        if (name.isEmpty()) return java.util.Optional.empty();
        if (name.codePointCount(0, name.length()) <= MAX_NAME) return java.util.Optional.of(name);
        return java.util.Optional.of(name.substring(0, name.offsetByCodePoints(0, MAX_NAME)));
    }

    /** Google's name, else the email-derived placeholder (not public: display_name_chosen is false then). */
    private static String displayName(GoogleIdentity google, String email) {
        return googleName(google).orElseGet(() -> DisplayNames.fromEmail(email));
    }

    /** Drops control (Cc) and format (Cf: zero-width, RTL override...) characters. */
    private static String stripInvisible(String s) {
        StringBuilder out = new StringBuilder(s.length());
        s.codePoints().filter(cp -> {
            int t = Character.getType(cp);
            return t != Character.CONTROL && t != Character.FORMAT;
        }).forEach(out::appendCodePoint);
        return out.toString();
    }
}
