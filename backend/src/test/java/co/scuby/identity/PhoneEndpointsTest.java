package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.GoogleTestKeys;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;

import static co.scuby.db.generated.Tables.CODE_SEND;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PHONE_OTP;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class PhoneEndpointsTest {

    static final String PHONE = "+573009998877";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingSmsSender sms;
    @Autowired RecordingEmailSender emails;
    @Autowired GoogleTestKeys keys;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        accounts.signIn(api, "carolina@correo.co");
    }

    private ApiResponse startChange(ApiClient as, String phone) {
        return as.post("/me/phone", "{\"phone\":\"" + phone + "\"}");
    }

    private ApiResponse verify(String phone, String code) {
        return api.post("/me/phone/verify", "{\"phone\":\"" + phone + "\",\"code\":\"" + code + "\"}");
    }

    // Port of web/src/mocks/backend.test.ts «changes the phone only after the SMS code».
    @Test
    void changesThePhoneOnlyAfterTheSmsCode() {
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
        assertThat(api.get("/session").isNull("/phone")).isTrue();
        String code = sms.lastCodeFor(PHONE);
        String wrong = code.equals("000000") ? "111111" : "000000";
        assertThat(verify(PHONE, wrong).errorCode()).isEqualTo("invalid_code");
        ApiResponse profile = verify(PHONE, code);
        assertThat(profile.status()).isEqualTo(200);
        assertThat(profile.str("/phone")).isEqualTo(PHONE);
        assertThat(profile.json().at("/notification_prefs/lost").asBoolean()).isTrue();
        assertThat(profile.isNull("/photo_url")).isTrue();
        assertThat(api.get("/session").str("/phone")).isEqualTo(PHONE);
    }

    @Test
    void aCodeWorksOnlyOnce() {
        startChange(api, PHONE);
        String code = sms.lastCodeFor(PHONE);
        assertThat(verify(PHONE, code).status()).isEqualTo(200);
        assertThat(verify(PHONE, code).errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        ApiResponse r = startChange(clients.newBrowser(), PHONE);
        assertThat(r.status()).isEqualTo(401);
    }

    @Test
    void theNumberIsValidatedBeforeAnySend() {
        ApiResponse r = startChange(api, "+5716012345");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
        assertThat(sms.sent()).isEmpty();
    }

    @Test
    void verifyingWithoutAStartIsInvalid() {
        assertThat(verify(PHONE, "123456").errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void aCodeExpiresAfterFiveMinutesAndBurnsAfterThreeMisses() {
        startChange(api, PHONE);
        String code = sms.lastCodeFor(PHONE);
        clock.advance(Duration.ofMinutes(5).plusSeconds(1));
        assertThat(verify(PHONE, code).errorCode()).isEqualTo("invalid_code");

        clock.advance(Duration.ofMinutes(1));
        startChange(api, PHONE);
        String fresh = sms.lastCodeFor(PHONE);
        String wrong = fresh.equals("000000") ? "111111" : "000000";
        for (int i = 0; i < 3; i++) verify(PHONE, wrong);
        assertThat(verify(PHONE, fresh).errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void aRepeatInsideTheCooldownDoesNotResend() {
        startChange(api, PHONE);
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
        assertThat(sms.sent()).hasSize(1);
        clock.advance(Duration.ofSeconds(61));
        startChange(api, PHONE);
        assertThat(sms.sent()).hasSize(2);
    }

    @Test
    void fourSendsPerNumberPerDayThenRateLimited() {
        for (int i = 0; i < 4; i++) {
            assertThat(startChange(api, PHONE).status()).isEqualTo(204);
            clock.advance(Duration.ofSeconds(61));
        }
        assertThat(startChange(api, PHONE).errorCode()).isEqualTo("rate_limited");
        clock.advance(Duration.ofHours(24));
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
    }

    @Test
    void oneDeviceIsThrottledAcrossNumbersAndAccounts() {
        for (int i = 0; i < 10; i++) {
            assertThat(startChange(api, "+57300000%04d".formatted(100 + i)).status()).isEqualTo(204);
        }
        assertThat(startChange(api, "+573000000200").errorCode()).isEqualTo("rate_limited");
    }

    @Test
    void aCappedDeviceGetsRateLimitedEvenForANumberInCooldown() {
        // No enumeration oracle: the device cap answers before the cooldown does.
        for (int i = 0; i < 10; i++) startChange(api, "+57300000%04d".formatted(100 + i));
        assertThat(startChange(api, "+573000000100").errorCode()).isEqualTo("rate_limited");
    }

    @Test
    void oneIpIsThrottledAcrossDevices() {
        for (int i = 0; i < 20; i++) {
            ApiClient other = clients.newBrowser().from("198.51.100.99");
            accounts.signIn(other, "p" + i + "@correo.co");
            assertThat(startChange(other, "+57300100%04d".formatted(i)).status()).isEqualTo(204);
        }
        ApiClient last = clients.newBrowser().from("198.51.100.99");
        accounts.signIn(last, "last@correo.co");
        assertThat(startChange(last, "+573001009999").errorCode()).isEqualTo("rate_limited");
    }

    @Test
    void aTestNumberUsesTheFixedCodeAndSendsNothing() {
        startChange(api, "+573000000001");
        assertThat(sms.sent()).isEmpty();
        assertThat(verify("+573000000001", "123456").str("/phone")).isEqualTo("+573000000001");
    }

    @Test
    void aTestNumberSkipsTheCooldownAndEveryThrottleAndIsAlwaysRewritten() {
        // Test bypass (design · Test bypasses): e2e specs verify the same test number many times a day.
        for (int i = 0; i < 6; i++) {
            assertThat(startChange(api, "+573000000002").status()).isEqualTo(204);
            assertThat(verify("+573000000002", "123456").status()).isEqualTo(200);
        }
        assertThat(sms.sent()).isEmpty();
        assertThat(db.fetchCount(CODE_SEND)).isZero();
    }

    @Test
    void aTestNumberIsNotCountedAgainstTheDeviceCap() {
        for (int i = 0; i < 15; i++) startChange(api, "+573000000003");
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
    }

    @Test
    void codesAreStoredAsAKeyedHashNotAPlainOne() {
        startChange(api, PHONE);
        String code = sms.lastCodeFor(PHONE);
        String stored = db.select(PHONE_OTP.CODE_HASH).from(PHONE_OTP).fetchOne().value1();
        assertThat(stored).matches("^[0-9a-f]{64}$").isNotEqualTo(co.scuby.platform.crypto.Hashing.sha256Hex(PHONE + ":" + code));
    }

    @Test
    void anEmailCodeReclaimClearsAPhoneTheAttackerVerifiedThroughGoogle() {
        String victim = "victim@correo.co";
        ApiClient attacker = clients.newBrowser();
        assertThat(attacker.post("/auth/google", "{\"credential\":\""
                + keys.token(GoogleTestKeys.claims("attacker-sub", victim, clock.instant())) + "\"}").status()).isEqualTo(200);
        attacker.post("/me/phone", "{\"phone\":\"" + PHONE + "\"}");
        String code = sms.lastCodeFor(PHONE);
        assertThat(attacker.post("/me/phone/verify", "{\"phone\":\"" + PHONE + "\",\"code\":\"" + code + "\"}").status()).isEqualTo(200);
        attacker.post("/me/phone", "{\"phone\":\"+573009998866\"}");   // a pending code, not yet verified
        assertThat(db.selectFrom(PERSON).where(PERSON.EMAIL.eq(victim)).fetchOne().getPhone()).isEqualTo(PHONE);

        ApiClient owner = clients.newBrowser();
        owner.post("/auth/email/start", "{\"email\":\"" + victim + "\"}");
        assertThat(owner.post("/auth/email/verify", "{\"email\":\"" + victim + "\",\"code\":\"" + emails.lastCodeFor(victim) + "\"}")
                        .status()).isEqualTo(200);

        var person = db.selectFrom(PERSON).where(PERSON.EMAIL.eq(victim)).fetchOne();
        assertThat(person.getGoogleSub()).isNull();
        assertThat(person.getPhone()).isNull();
        assertThat(person.getPhoneVerifiedAt()).isNull();
        assertThat(db.fetchCount(PHONE_OTP)).isZero();
        assertThat(owner.get("/session").isNull("/phone")).isTrue();
    }
}
