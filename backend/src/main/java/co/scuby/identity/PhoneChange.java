package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.util.UUID;

/**
 * `/me/phone/verify`: reserve the attempt first (no transaction open), then in one transaction consume the
 * code and store the number verified. Deliberately not @Transactional itself.
 */
@Service
class PhoneChange {

    private final PhoneOtp otp;
    private final People people;
    private final Clock clock;
    private final TransactionTemplate tx;

    PhoneChange(PhoneOtp otp, People people, Clock clock, TransactionTemplate tx) {
        this.otp = otp;
        this.people = people;
        this.clock = clock;
        this.tx = tx;
    }

    public Person verify(UUID personId, String phone, String code) {
        PhoneOtp.Reservation reservation = otp.reserveAndCheck(personId, phone, code)
                .orElseThrow(() -> new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code"));
        return tx.execute(status -> {
            // Person row first, then phone_otp: the order an email-code reclaim takes (unlink, then discard the
            // codes). The other way round deadlocks with it; after a reclaim commits there is no code to consume.
            people.lock(personId);
            if (!otp.consume(reservation)) throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
            people.setPhone(personId, phone, clock.instant());
            return people.get(personId);
        });
    }
}
