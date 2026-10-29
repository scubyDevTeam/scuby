package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

@Service
class EmailSignIn {

    private static final Logger log = LoggerFactory.getLogger(EmailSignIn.class);

    private final EmailCodes codes;
    private final People people;
    private final SessionStore sessions;

    EmailSignIn(EmailCodes codes, People people, SessionStore sessions) {
        this.codes = codes;
        this.people = people;
        this.sessions = sessions;
    }

    static String normalize(String email) {
        return email.strip().toLowerCase(Locale.ROOT);
    }

    @Transactional
    public void start(String email, Caller caller) {
        codes.start(normalize(email), caller);
    }

    /** A wrong code throws invalid_code, but the spent attempt is committed (noRollbackFor). */
    @Transactional(noRollbackFor = ApiException.class)
    public Person verify(String email, String code) {
        String normalized = normalize(email);
        if (!codes.consume(normalized, code)) throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
        Person person = people.byEmail(normalized).orElseGet(() -> people.create(normalized, DisplayNames.fromEmail(normalized), null, false));
        // Proving the mailbox beats a Google link that only vouched for it non-authoritatively (someone may
        // have created a Google account with this address): drop the link and every session it opened.
        if (person.googleSub() != null && Boolean.FALSE.equals(person.googleEmailAuthoritative())
                && people.unlinkNonAuthoritativeGoogle(person.id())) {
            sessions.deleteAllOf(person.id());
            log.info("Email-code sign-in unlinked a non-authoritative Google identity from account {} and ended its sessions", person.id());
            return people.get(person.id());
        }
        return person;
    }
}
