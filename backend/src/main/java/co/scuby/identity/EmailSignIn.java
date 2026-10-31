package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Locale;
import java.util.Optional;

@Service
class EmailSignIn {

    private static final Logger log = LoggerFactory.getLogger(EmailSignIn.class);

    private final EmailCodes codes;
    private final People people;
    private final SessionStore sessions;
    private final SignInSessions signInSessions;
    private final PhoneOtp phoneOtp;

    private final TransactionTemplate tx;

    EmailSignIn(EmailCodes codes, People people, SessionStore sessions, SignInSessions signInSessions, PhoneOtp phoneOtp,
                TransactionTemplate tx) {
        this.tx = tx;
        this.phoneOtp = phoneOtp;
        this.codes = codes;
        this.people = people;
        this.sessions = sessions;
        this.signInSessions = signInSessions;
    }

    static String normalize(String email) {
        return email.strip().toLowerCase(Locale.ROOT);
    }

    /** Stores the code in one transaction, then sends it (a failed send leaves the stored code unused: server_error). */
    public void start(String email, Caller caller) {
        EmailCodes.Outgoing outgoing = tx.execute(status -> codes.start(normalize(email), caller));
        if (outgoing != null) codes.deliver(outgoing);
    }

    /**
     * A wrong code throws invalid_code, but the spent attempt is committed (noRollbackFor). The account and
     * its new session are one transaction: the unlink UPDATE locks the person row until commit, so a Google
     * sign-in racing it (which locks the same row) either runs wholly before (its session is deleted here)
     * or wholly after (it finds the link gone).
     */
    @Transactional(noRollbackFor = ApiException.class)
    public SignedIn verify(String email, String code, Optional<String> carriedTokenHash) {
        String normalized = normalize(email);
        if (!codes.consume(normalized, code)) throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
        Person person = people.byEmail(normalized).orElseGet(() -> people.create(normalized, DisplayNames.fromEmail(normalized), false, null, false));
        // Proving the mailbox beats a Google link that only vouched for it non-authoritatively (someone may
        // have created a Google account with this address): drop the link and every session it opened.
        if (person.googleSub() != null && Boolean.FALSE.equals(person.googleEmailAuthoritative())
                && people.unlinkNonAuthoritativeGoogle(person.id(), DisplayNames.fromEmail(normalized))) {
            sessions.deleteAllOf(person.id());
            // The unlink also cleared a phone the attacker may have verified; their pending phone codes go too.
            phoneOtp.discardAllOf(person.id());
            log.info("Email-code sign-in unlinked a non-authoritative Google identity from account {} and ended its sessions", person.id());
            person = people.get(person.id());
        }
        return new SignedIn(person, signInSessions.open(person.id(), carriedTokenHash));
    }
}
