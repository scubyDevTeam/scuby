package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;

import static co.scuby.db.generated.Tables.CODE_SEND;
import static co.scuby.db.generated.Tables.PHONE_OTP;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class PhoneEndpointsTest {

    static final String PHONE = "+573009998877";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingSmsSender sms;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired org.springframework.beans.factory.ObjectProvider<co.scuby.platform.cache.ClearableCache> caches;

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

    /** Pins the ceiling in StatementCeilings: session lookup, supported_countries, send count, guarded otp upsert, send-log insert. No locks. */
    @Test
    void aSendOnASessionCacheMissIsExactlyFiveStatements() {
        caches.orderedStream().filter(c -> !(c instanceof co.scuby.platform.flags.FeatureFlags)).forEach(co.scuby.platform.cache.ClearableCache::clear);
        assertThat(startChange(api, PHONE).statements()).hasSize(5);
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
    void fiveSendsPerNumberInARollingDayThenRateLimited() {
        for (int i = 0; i < 5; i++) {
            assertThat(startChange(api, PHONE).status()).isEqualTo(204);
            clock.advance(Duration.ofSeconds(61));
        }
        assertThat(sms.sent()).hasSize(5);
        assertThat(startChange(api, PHONE).errorCode()).isEqualTo("rate_limited");
        // The first send was at START; the window is rolling, so it is still full a minute before 24 h have passed...
        clock.set(MutableClock.START.plus(Duration.ofHours(24)).minusSeconds(60));
        assertThat(startChange(api, PHONE).errorCode()).isEqualTo("rate_limited");
        // ...and frees one place as soon as the first send is older than 24 h.
        clock.set(MutableClock.START.plus(Duration.ofHours(24)).plusSeconds(1));
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
        assertThat(sms.sent()).hasSize(6);
    }

    @Test
    void theDayIsRollingNotTheCalendarDay() {
        // Five sends just before UTC midnight; a calendar-day counter would reset at 00:00.
        clock.set(Instant.parse("2026-10-14T23:50:00Z"));
        for (int i = 0; i < 5; i++) {
            startChange(api, PHONE);
            clock.advance(Duration.ofSeconds(61));
        }
        clock.set(Instant.parse("2026-10-15T00:30:00Z"));
        assertThat(startChange(api, PHONE).errorCode()).isEqualTo("rate_limited");
        assertThat(sms.sent()).hasSize(5);
    }

    @Test
    void thereIsNoCapPerDeviceOrAccountOnlyPerNumber() {
        // One account, one device: twelve different numbers are all sent (the only caps are per number and the cooldown).
        for (int i = 0; i < 12; i++) assertThat(startChange(api, "+57300100%04d".formatted(100 + i)).status()).isEqualTo(204);
        assertThat(sms.sent()).hasSize(12);
        for (int i = 0; i < 12; i++) {
            ApiClient other = clients.newBrowser();
            accounts.signIn(other, "p" + i + "@correo.co");
            assertThat(startChange(other, "+57300101%04d".formatted(i)).status()).isEqualTo(204);
        }
    }

    @Test
    void theNumberCapCountsSendsFromAllAccounts() {
        ApiClient other = clients.newBrowser();
        accounts.signIn(other, "other@correo.co");
        for (int i = 0; i < 2; i++) {
            assertThat(startChange(api, PHONE).status()).isEqualTo(204);
            clock.advance(Duration.ofSeconds(61));
            assertThat(startChange(other, PHONE).status()).isEqualTo(204);
            clock.advance(Duration.ofSeconds(61));
        }
        assertThat(sms.sent()).hasSize(4);
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);   // the fifth send, by whichever account
        clock.advance(Duration.ofSeconds(61));
        assertThat(startChange(api, PHONE).errorCode()).isEqualTo("rate_limited");
        assertThat(startChange(other, PHONE).errorCode()).isEqualTo("rate_limited");
    }

    /** The 60 s between sends is a rule of the number, whichever account asks (decision 56). */
    @Test
    void theCooldownBelongsToTheNumberNotToTheAccount() {
        ApiClient other = clients.newBrowser();
        accounts.signIn(other, "other@correo.co");
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
        assertThat(startChange(other, PHONE).status()).as("answered as sent").isEqualTo(204);
        assertThat(sms.sent()).as("but nothing went out inside the number's cooldown").hasSize(1);
        assertThat(db.fetchCount(CODE_SEND)).isEqualTo(1);
        assertThat(db.fetchCount(PHONE_OTP)).as("and the second account stored no code").isEqualTo(1);
        clock.advance(Duration.ofSeconds(61));
        assertThat(startChange(other, PHONE).status()).isEqualTo(204);
        assertThat(sms.sent()).hasSize(2);
    }

    @Test
    void aCodeForOneNumberFailsForAnother() {
        String other = "+573009998866";
        startChange(api, PHONE);
        startChange(api, other);
        String forPhone = sms.lastCodeFor(PHONE);
        String forOther = sms.lastCodeFor(other);
        // Only a code that differs proves the binding; with equal codes the test has nothing to show.
        org.junit.jupiter.api.Assumptions.assumeTrue(!forPhone.equals(forOther));
        assertThat(verify(other, forPhone).errorCode()).isEqualTo("invalid_code");
        assertThat(verify(PHONE, forOther).errorCode()).isEqualTo("invalid_code");
        assertThat(verify(PHONE, forPhone).status()).isEqualTo(200);
    }

    @Test
    void aCodeForOneAccountFailsForAnother() {
        startChange(api, PHONE);
        String code = sms.lastCodeFor(PHONE);
        ApiClient intruder = clients.newBrowser();
        accounts.signIn(intruder, "intruder@correo.co");
        assertThat(intruder.post("/me/phone/verify", "{\"phone\":\"" + PHONE + "\",\"code\":\"" + code + "\"}").errorCode())
                .isEqualTo("invalid_code");
        assertThat(intruder.get("/session").isNull("/phone")).isTrue();
        assertThat(verify(PHONE, code).status()).isEqualTo(200);   // the owner's code is untouched
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
    void codesAreStoredAsAKeyedHashNotAPlainOne() {
        startChange(api, PHONE);
        String code = sms.lastCodeFor(PHONE);
        String stored = db.select(PHONE_OTP.CODE_HASH).from(PHONE_OTP).fetchOne().value1();
        assertThat(stored).matches("^[0-9a-f]{64}$").isNotEqualTo(co.scuby.platform.crypto.Hashing.sha256Hex(PHONE + ":" + code));
    }
}
