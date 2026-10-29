package co.scuby.identity;

import org.jooq.DSLContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static co.scuby.db.generated.Tables.PHONE_OTP;

/**
 * A wrong OTP attempt, committed on its own (REQUIRES_NEW) so it counts even when the caller answers
 * invalid_code and rolls back. A separate bean: a self-call would bypass the transactional proxy.
 */
@Component
class PhoneOtpMisses {

    private final DSLContext db;

    PhoneOtpMisses(DSLContext db) {
        this.db = db;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(UUID personId, String phone) {
        db.update(PHONE_OTP)
          .set(PHONE_OTP.ATTEMPTS, PHONE_OTP.ATTEMPTS.plus(1))
          .where(PHONE_OTP.PERSON_ID.eq(personId), PHONE_OTP.PHONE.eq(phone))
          .execute();
    }
}
