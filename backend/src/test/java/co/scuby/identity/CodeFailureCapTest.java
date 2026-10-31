package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
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
import java.time.Instant;

import static co.scuby.db.generated.Tables.CODE_SEND;
import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Failed code checks are capped at 10 per address and 10 per number in a rolling 24 h, however many codes are issued
 * (docs/eng/auth.md · Guessing budget, decision 65). A new code never resets the count, and past the cap even the
 * right code answers rate_limited. Test numbers and addresses are never counted.
 */
@IntegrationTest
class CodeFailureCapTest {

    static final String PHONE = "+573009998877";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingEmailSender emails;
    @Autowired RecordingSmsSender sms;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    private ApiResponse startEmail(String email) {
        return api.post("/auth/email/start", "{\"email\":\"" + email + "\"}");
    }

    private ApiResponse verifyEmail(String email, String code) {
        return api.post("/auth/email/verify", "{\"email\":\"" + email + "\",\"code\":\"" + code + "\"}");
    }

    private static String wrongFor(String code) {
        return code.equals("000000") ? "111111" : "000000";
    }

    /** Ten wrong checks on one address, over four codes (3 + 3 + 3 + 1), a minute apart. */
    private void tenFailuresOnEmail(String email) {
        int failures = 0;
        while (failures < 10) {
            startEmail(email);
            String wrong = wrongFor(emails.lastCodeFor(email));
            for (int i = 0; i < 3 && failures < 10; i++, failures++) {
                assertThat(verifyEmail(email, wrong).errorCode()).isEqualTo("invalid_code");
            }
            clock.advance(Duration.ofSeconds(61));
        }
    }

    @Test
    void aNewCodeDoesNotResetTheFailedCountAndTheRightCodeIsRateLimitedAtTheCap() {
        tenFailuresOnEmail("ana@correo.co");
        startEmail("ana@correo.co");
        String right = emails.lastCodeFor("ana@correo.co");
        ApiResponse r = verifyEmail("ana@correo.co", right);
        assertThat(r.status()).isEqualTo(429);
        assertThat(r.errorCode()).isEqualTo("rate_limited");
        assertThat(db.fetchCount(PERSON)).as("no account, no session for a guess past the cap").isZero();
        assertThat(r.setCookies()).noneMatch(c -> c.startsWith("__Host-session="));
    }

    @Test
    void theNinthFailureStillAnswersInvalidCodeAndTheTenthIsTheLastCharge() {
        startEmail("ana@correo.co");
        String wrong = wrongFor(emails.lastCodeFor("ana@correo.co"));
        for (int i = 0; i < 3; i++) verifyEmail("ana@correo.co", wrong);
        clock.advance(Duration.ofSeconds(61));
        startEmail("ana@correo.co");
        for (int i = 0; i < 3; i++) verifyEmail("ana@correo.co", wrong);
        clock.advance(Duration.ofSeconds(61));
        startEmail("ana@correo.co");
        for (int i = 0; i < 3; i++) verifyEmail("ana@correo.co", wrong);       // nine failures
        clock.advance(Duration.ofSeconds(61));
        startEmail("ana@correo.co");
        String right = emails.lastCodeFor("ana@correo.co");
        assertThat(verifyEmail("ana@correo.co", wrongFor(right)).errorCode()).isEqualTo("invalid_code");   // the tenth
        assertThat(verifyEmail("ana@correo.co", right).errorCode()).isEqualTo("rate_limited");
    }

    @Test
    void theWindowIsRollingTheCapLiftsWhenTheOldestFailuresAgeOut() {
        Instant first = clock.instant();      // three failures happen at this instant; the other seven come later
        tenFailuresOnEmail("ana@correo.co");
        clock.set(first.plus(Duration.ofHours(24)).minusSeconds(1));
        startEmail("ana@correo.co");
        String code = emails.lastCodeFor("ana@correo.co");
        assertThat(verifyEmail("ana@correo.co", code).errorCode()).as("still ten failures inside 24 h").isEqualTo("rate_limited");
        clock.set(first.plus(Duration.ofHours(24)).plusSeconds(1));
        assertThat(verifyEmail("ana@correo.co", code).status()).as("three aged out, seven remain").isEqualTo(200);
    }

    @Test
    void afterAFullDayEverythingIsAllowedAgain() {
        tenFailuresOnEmail("ana@correo.co");
        clock.advance(Duration.ofHours(25));
        startEmail("ana@correo.co");
        assertThat(verifyEmail("ana@correo.co", emails.lastCodeFor("ana@correo.co")).status()).isEqualTo(200);
    }

    @Test
    void anotherAddressIsUnaffected() {
        tenFailuresOnEmail("ana@correo.co");
        startEmail("bea@correo.co");
        assertThat(verifyEmail("bea@correo.co", emails.lastCodeFor("bea@correo.co")).status()).isEqualTo(200);
    }

    @Test
    void aSuccessfulSignInDoesNotForgetTheFailures() {
        startEmail("ana@correo.co");
        String wrong = wrongFor(emails.lastCodeFor("ana@correo.co"));
        for (int i = 0; i < 2; i++) verifyEmail("ana@correo.co", wrong);
        assertThat(verifyEmail("ana@correo.co", emails.lastCodeFor("ana@correo.co")).status()).isEqualTo(200);
        assertThat(db.fetchCount(CODE_SEND, CODE_SEND.KIND.eq("fail"))).isEqualTo(2);
    }

    @Test
    void aWrongCheckWithNoLiveCodeIsNotCountedSoNobodyGrowsTheLogWithoutAStart() {
        for (int i = 0; i < 20; i++) assertThat(verifyEmail("nadie" + i + "@correo.co", "123456").errorCode()).isEqualTo("invalid_code");
        assertThat(db.fetchCount(CODE_SEND)).isZero();
    }

    @Test
    void theFailuresDoNotCountAsSendsSoTheSendCapIsUnchanged() {
        startEmail("ana@correo.co");
        String wrong = wrongFor(emails.lastCodeFor("ana@correo.co"));
        for (int i = 0; i < 3; i++) verifyEmail("ana@correo.co", wrong);
        for (int i = 0; i < 9; i++) {
            clock.advance(Duration.ofSeconds(61));
            startEmail("ana@correo.co");
        }
        assertThat(emails.sent()).hasSize(10);
    }

    @Test
    void aTestAddressIsNeverCountedOrCapped() {
        String email = "qa@e2e.scuby.test";
        for (int i = 0; i < 15; i++) {
            startEmail(email);
            assertThat(verifyEmail(email, "999999").errorCode()).isEqualTo("invalid_code");
        }
        assertThat(db.fetchCount(CODE_SEND)).isZero();
        startEmail(email);
        assertThat(verifyEmail(email, "123456").status()).isEqualTo(200);
    }

    // ---- SMS ----

    private ApiClient signedIn(String email) {
        ApiClient c = clients.newBrowser();
        accounts.signIn(c, email);
        return c;
    }

    private ApiResponse startPhone(ApiClient c, String phone) {
        return c.post("/me/phone", "{\"phone\":\"" + phone + "\"}");
    }

    private ApiResponse verifyPhone(ApiClient c, String phone, String code) {
        return c.post("/me/phone/verify", "{\"phone\":\"" + phone + "\",\"code\":\"" + code + "\"}");
    }

    /** Ten wrong checks on one number, over four codes, from four different accounts (a code is per account and number). */
    private void tenFailuresOnPhone(String phone) {
        int failures = 0;
        int account = 0;
        while (failures < 10) {
            ApiClient c = signedIn("sms" + account++ + "@correo.co");
            startPhone(c, phone);
            String wrong = wrongFor(sms.lastCodeFor(phone));
            for (int i = 0; i < 3 && failures < 10; i++, failures++) {
                assertThat(verifyPhone(c, phone, wrong).errorCode()).isEqualTo("invalid_code");
            }
            clock.advance(Duration.ofSeconds(61));
        }
    }

    @Test
    void theNumberCapCountsFailuresFromEveryAccountAndLimitsTheRightCodeToo() {
        tenFailuresOnPhone(PHONE);
        ApiClient victim = signedIn("owner@correo.co");
        startPhone(victim, PHONE);
        ApiResponse r = verifyPhone(victim, PHONE, sms.lastCodeFor(PHONE));
        assertThat(r.status()).isEqualTo(429);
        assertThat(r.errorCode()).isEqualTo("rate_limited");
        assertThat(victim.get("/session").isNull("/phone")).as("the number was not attached").isTrue();
    }

    @Test
    void theNumberRecoversAfterTheWindow() {
        tenFailuresOnPhone(PHONE);
        clock.advance(Duration.ofHours(25));
        ApiClient c = signedIn("owner@correo.co");
        startPhone(c, PHONE);
        assertThat(verifyPhone(c, PHONE, sms.lastCodeFor(PHONE)).status()).isEqualTo(200);
    }

    @Test
    void anotherNumberIsUnaffected() {
        tenFailuresOnPhone(PHONE);
        ApiClient c = signedIn("owner@correo.co");
        startPhone(c, "+573001234567");
        assertThat(verifyPhone(c, "+573001234567", sms.lastCodeFor("+573001234567")).status()).isEqualTo(200);
    }

    @Test
    void aTestNumberIsNeverCountedOrCapped() {
        ApiClient c = signedIn("qa@correo.co");
        for (int i = 0; i < 15; i++) {
            startPhone(c, "+573000000003");
            assertThat(verifyPhone(c, "+573000000003", "999999").errorCode()).isEqualTo("invalid_code");
        }
        assertThat(db.fetchCount(CODE_SEND)).isZero();
        assertThat(verifyPhone(c, "+573000000003", "123456").status()).isEqualTo(200);
    }

    @Test
    void thePublishCodeCheckIsCappedTooAndSharesTheNumbersCount() {
        tenFailuresOnPhone(PHONE);
        ApiClient c = signedIn("owner@correo.co");
        var first = c.post("/lost-cases", co.scuby.support.PublishBodies.kira(PHONE, null));
        assertThat(first.status()).isEqualTo(200);   // a send is not a check: the code is still issued
        ApiResponse r = c.post("/lost-cases", co.scuby.support.PublishBodies.kira(PHONE, sms.lastCodeFor(PHONE)));
        assertThat(r.errorCode()).isEqualTo("rate_limited");
    }
}
