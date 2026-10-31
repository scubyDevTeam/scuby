package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Optional;
import java.util.UUID;

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
     * One account per email; Google and the email code point at the same row (docs/eng/auth.md · Google sign-in).
     * <ul>
     *   <li>By `sub` first: an account already linked to this Google identity signs in, whatever address Google now reports.</li>
     *   <li>Otherwise, an <b>authoritative</b> address (gmail.com, googlemail.com, or a Workspace `hd` equal to its
     *       domain) creates the account or links the existing one with that email (never over another `sub`).</li>
     *   <li>Any other verified address only proves that some provider said so, so it never creates or links by
     *       itself: with no session it is refused; with a session of the account whose email is exactly this
     *       one (the person proved the mailbox with the email code) the identity is linked for good; a session
     *       of another account is refused. Nothing is ever linked across emails.</li>
     * </ul>
     * No row locks: the link is a conditional UPDATE (`google_sub IS NULL`), and People.create keeps the row a
     * concurrent sign-in inserted for the same email.
     *
     * @param sessionPersonId the account of the session the browser carries, if any
     */
    public SignedIn signIn(String credential, Optional<String> carriedTokenHash, @Nullable UUID sessionPersonId) {
        // Verified BEFORE the transaction opens: on a key-cache miss this fetches Google's JWKS over HTTP, and a
        // slow Google must not hold a pooled connection per waiting sign-in.
        GoogleIdentity google = tokens.verify(credential);
        try {
            return tx.execute(status -> signIn(google, carriedTokenHash, sessionPersonId));
        } catch (DataIntegrityViolationException e) {
            // A concurrent sign-in put this `sub` on another account first (UNIQUE google_sub): refused like any
            // other Google sign-in that cannot link. Caught outside the transaction, which Postgres has aborted.
            log.warn("Google sign-in refused: this Google identity is already linked to another account");
            throw new ApiException(ErrorCode.UNAUTHORIZED, "this Google account is already linked to another account");
        }
    }

    private SignedIn signIn(GoogleIdentity google, Optional<String> carriedTokenHash, @Nullable UUID sessionPersonId) {
        Person account = resolve(google, sessionPersonId);
        return new SignedIn(account, sessions.open(account.id(), carriedTokenHash));
    }

    private Person resolve(GoogleIdentity google, @Nullable UUID sessionPersonId) {
        Optional<Person> bySub = people.byGoogleSub(google.sub());
        if (bySub.isPresent()) return bySub.get();
        String email = EmailSignIn.normalize(google.email());
        if (google.emailAuthoritative()) {
            Person account = people.byEmail(email).orElseGet(
                    () -> people.create(email, displayName(google, email), googleName(google).isPresent(), google.sub()));
            return linked(account, google.sub());
        }
        if (sessionPersonId == null) {
            log.warn("Google sign-in refused: the address is not Google-authoritative and there is no email-code session");
            throw new ApiException(ErrorCode.UNAUTHORIZED, "sign in with your email code first");
        }
        Person signedIn = people.get(sessionPersonId);
        if (!signedIn.email().equals(email)) {
            log.warn("Google sign-in refused: the session belongs to another email than the Google address");
            throw new ApiException(ErrorCode.UNAUTHORIZED, "this Google address is not the one you are signed in with");
        }
        return linked(signedIn, google.sub());
    }

    /** The account, with this Google identity on it: already (a concurrent twin won), or linked now; never over another `sub`. */
    private Person linked(Person account, String sub) {
        if (sub.equals(account.googleSub())) return account;
        if (account.googleSub() == null && people.linkGoogle(account.id(), sub)) return people.get(account.id());
        Person current = people.get(account.id());                       // lost a race: fine if the winner is us
        if (sub.equals(current.googleSub())) return current;
        log.warn("Google sign-in refused: account {} is linked to another Google identity", account.id());
        throw new ApiException(ErrorCode.UNAUTHORIZED, "this account is linked to another Google account");
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
