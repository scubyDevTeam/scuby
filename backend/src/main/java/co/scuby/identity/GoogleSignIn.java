package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class GoogleSignIn {

    private static final Logger log = LoggerFactory.getLogger(GoogleSignIn.class);
    static final int MAX_NAME = 80;   // person.display_name CHECK

    private final GoogleIdTokens tokens;
    private final People people;

    GoogleSignIn(GoogleIdTokens tokens, People people) {
        this.tokens = tokens;
        this.people = people;
    }

    /**
     * By `sub`; else link the account with the same verified email — only if it has no Google identity
     * yet (the identity key is `sub`: a different one never replaces it); else create one. People.create
     * keeps the row a concurrent sign-in inserted for the same email (and drops our sub), so whatever
     * account we end with is linked with a conditional update and re-checked: exactly one account, and
     * its google_sub is the one that won.
     */
    @Transactional
    public Person signIn(String credential) {
        GoogleIdentity google = tokens.verify(credential);
        return people.byGoogleSub(google.sub()).orElseGet(() -> {
            String email = EmailSignIn.normalize(google.email());
            Person account = people.byEmail(email)
                    .orElseGet(() -> people.create(email, displayName(google, email), google.sub()));
            if (google.sub().equals(account.googleSub())) return account;
            if (account.googleSub() == null && people.linkGoogle(account.id(), google.sub())) return people.get(account.id());
            log.warn("Google sign-in refused: account {} is linked to another Google identity", account.id());
            throw new ApiException(ErrorCode.UNAUTHORIZED, "this account is linked to another Google account");
        });
    }

    private static String displayName(GoogleIdentity google, String email) {
        if (google.name() == null || google.name().isBlank()) return DisplayNames.fromEmail(email);
        String name = google.name().strip();
        if (name.codePointCount(0, name.length()) <= MAX_NAME) return name;
        return name.substring(0, name.offsetByCodePoints(0, MAX_NAME));
    }
}
