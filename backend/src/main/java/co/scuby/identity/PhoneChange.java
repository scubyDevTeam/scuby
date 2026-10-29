package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

/** `/me/phone/verify` in one transaction: consume the code, store the number verified. */
@Service
class PhoneChange {

    private final PhoneOtp otp;
    private final People people;
    private final Clock clock;

    PhoneChange(PhoneOtp otp, People people, Clock clock) {
        this.otp = otp;
        this.people = people;
        this.clock = clock;
    }

    @Transactional
    public Person verify(UUID personId, String phone, String code) {
        if (!otp.check(personId, phone, code)) throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
        people.setPhone(personId, phone, clock.instant());
        return people.get(personId);
    }
}
