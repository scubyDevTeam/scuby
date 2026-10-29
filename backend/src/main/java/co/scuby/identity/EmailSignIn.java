package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

@Service
class EmailSignIn {

    private final EmailCodes codes;
    private final People people;

    EmailSignIn(EmailCodes codes, People people) {
        this.codes = codes;
        this.people = people;
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
        return people.byEmail(normalized).orElseGet(() -> people.create(normalized, DisplayNames.fromEmail(normalized), null));
    }
}
