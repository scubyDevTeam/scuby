package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Locale;
import java.util.Optional;

@Service
class EmailSignIn {

    private final EmailCodes codes;
    private final People people;
    private final SignInSessions signInSessions;

    private final TransactionTemplate tx;

    EmailSignIn(EmailCodes codes, People people, SignInSessions signInSessions, TransactionTemplate tx) {
        this.tx = tx;
        this.codes = codes;
        this.people = people;
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
     * A wrong code throws invalid_code, but the spent attempt is committed (noRollbackFor). The account and its
     * new session are one transaction. Google never reaches this row on its own for a non-authoritative address,
     * so proving the mailbox here needs no reclaim logic: the code just signs in (and creates the account).
     */
    @Transactional(noRollbackFor = ApiException.class)
    public SignedIn verify(String email, String code, Optional<String> carriedTokenHash) {
        String normalized = normalize(email);
        if (!codes.consume(normalized, code)) throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
        Person person = people.byEmail(normalized).orElseGet(() -> people.create(normalized, DisplayNames.fromEmail(normalized), false, null));
        return new SignedIn(person, signInSessions.open(person.id(), carriedTokenHash));
    }
}
