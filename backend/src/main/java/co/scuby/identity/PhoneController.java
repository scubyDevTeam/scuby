package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class PhoneController {

    private final PhoneNumbers numbers;
    private final PhoneOtp otp;
    private final PhoneChange change;

    PhoneController(PhoneNumbers numbers, PhoneOtp otp, PhoneChange change) {
        this.numbers = numbers;
        this.otp = otp;
        this.change = change;
    }

    /** Not gated by publisher_phone_otp (that flag gates the publish step only). A repeat inside the cooldown is a silent 204. */
    @PostMapping("/me/phone")
    ResponseEntity<Void> start(Account account, Caller caller, @Valid @RequestBody PhoneRequests.Start body) {
        otp.send(account.personId(), numbers.requireMobile(body.phone(), "phone"), caller);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/me/phone/verify")
    ProfileView verify(Account account, @Valid @RequestBody PhoneRequests.Verify body) {
        String phone = numbers.requireMobile(body.phone(), "phone");
        return ProfileView.of(change.verify(account.personId(), phone, body.code()));
    }
}
