package co.scuby.identity;

import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;

import static co.scuby.db.generated.Tables.CODE_SEND;
import static co.scuby.db.generated.Tables.EMAIL_CODE;
import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class EmailSignInTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired RecordingEmailSender emails;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired EmailCodes codes;
    @Autowired org.springframework.beans.factory.ObjectProvider<co.scuby.platform.cache.ClearableCache> caches;
    @Autowired co.scuby.support.Accounts accounts;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    private ApiResponse start(String email) {
        return api.post("/auth/email/start", "{\"email\":\"" + email + "\"}");
    }

    private ApiResponse verify(String email, String code) {
        return api.post("/auth/email/verify", "{\"email\":\"" + email + "\",\"code\":\"" + code + "\"}");
    }

    @Test
    void theEmailedCodeSignsInAndBearsTheAccountLazily() {
        assertThat(start("Juan.Perez@Correo.co").status()).isEqualTo(204);
        String code = emails.lastCodeFor("juan.perez@correo.co");
        assertThat(code).matches("^\\d{6}$");
        assertThat(db.fetchCount(PERSON)).isZero();

        ApiResponse r = verify("juan.perez@correo.co", code);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).isEqualTo("Juan Perez");
        assertThat(db.fetchOne(PERSON).getDisplayNameChosen()).as("the placeholder is not a chosen name").isFalse();
        assertThat(r.str("/email")).isEqualTo("juan.perez@correo.co");
        assertThat(r.setCookies()).anyMatch(c -> c.startsWith("__Host-session=") && c.contains("HttpOnly")
                && c.contains("Secure") && c.contains("SameSite=Lax"));
        assertThat(api.get("/session").str("/email")).isEqualTo("juan.perez@correo.co");
    }

    @Test
    void aSecondSignInReusesTheAccount() {
        start("ana@correo.co");
        String first = verify("ana@correo.co", emails.lastCodeFor("ana@correo.co")).str("/id");
        clock.advance(Duration.ofMinutes(2));
        start("ana@correo.co");
        String second = clients.newBrowser().post("/auth/email/verify",
                "{\"email\":\"ana@correo.co\",\"code\":\"" + emails.lastCodeFor("ana@correo.co") + "\"}").str("/id");
        assertThat(second).isEqualTo(first);
        assertThat(db.fetchCount(PERSON)).isEqualTo(1);
    }

    @Test
    void aWrongCodeIsInvalidAndThreeWrongOnesBurnTheCode() {
        start("ana@correo.co");
        String code = emails.lastCodeFor("ana@correo.co");
        String wrong = code.equals("000000") ? "111111" : "000000";
        for (int i = 0; i < 3; i++) assertThat(verify("ana@correo.co", wrong).errorCode()).isEqualTo("invalid_code");
        assertThat(verify("ana@correo.co", code).errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void aCodeExpiresAfterFiveMinutes() {
        start("ana@correo.co");
        String code = emails.lastCodeFor("ana@correo.co");
        clock.advance(Duration.ofMinutes(5).plusSeconds(1));
        assertThat(verify("ana@correo.co", code).errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void aCodeWorksOnce() {
        start("ana@correo.co");
        String code = emails.lastCodeFor("ana@correo.co");
        assertThat(verify("ana@correo.co", code).status()).isEqualTo(200);
        assertThat(clients.newBrowser().post("/auth/email/verify",
                "{\"email\":\"ana@correo.co\",\"code\":\"" + code + "\"}").errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void anAddressNeverStartedIsInvalid() {
        assertThat(verify("nadie@correo.co", "123456").errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void resendingWaitsSixtySecondsAndStopsAtTenInARollingDayButAlwaysAnswers204() {
        start("ana@correo.co");
        assertThat(start("ana@correo.co").status()).isEqualTo(204);
        assertThat(emails.sent()).hasSize(1);
        for (int i = 0; i < 12; i++) {
            clock.advance(Duration.ofSeconds(61));
            assertThat(start("ana@correo.co").status()).isEqualTo(204);
        }
        assertThat(emails.sent()).hasSize(10);
        // The first send was at START: still inside 24 h a minute early, free one place a second after.
        clock.set(MutableClock.START.plus(Duration.ofHours(24)).minusSeconds(60));
        start("ana@correo.co");
        assertThat(emails.sent()).hasSize(10);
        clock.set(MutableClock.START.plus(Duration.ofHours(24)).plusSeconds(1));
        start("ana@correo.co");
        assertThat(emails.sent()).hasSize(11);
    }

    @Test
    void theDayIsRollingNotTheCalendarDay() {
        // Ten sends just before UTC midnight; a calendar-day counter would reset at 00:00 and send an eleventh.
        clock.set(Instant.parse("2026-10-14T23:30:00Z"));
        for (int i = 0; i < 10; i++) {
            start("ana@correo.co");
            clock.advance(Duration.ofSeconds(61));
        }
        assertThat(emails.sent()).hasSize(10);
        clock.set(Instant.parse("2026-10-15T01:00:00Z"));
        assertThat(start("ana@correo.co").status()).isEqualTo(204);
        assertThat(emails.sent()).hasSize(10);
    }

    /** Pins the ceiling in StatementCeilings: advisory lock, row select, send count, upsert, send-log insert (+ the session lookup when signed in). */
    @Test
    void aStartIsExactlyFiveStatementsOrSixOnASessionCacheMiss() {
        assertThat(start("ana@correo.co").statements()).hasSize(5);
        clock.advance(Duration.ofMinutes(2));
        accounts.signIn(api, "bea@correo.co");
        caches.orderedStream().filter(c -> !(c instanceof co.scuby.platform.flags.FeatureFlags)).forEach(co.scuby.platform.cache.ClearableCache::clear);
        assertThat(start("ana@correo.co").statements()).hasSize(6);
    }

    @Test
    void thereIsNoCapPerDeviceOrIp() {
        for (int i = 0; i < 25; i++) {
            ApiResponse r = clients.newBrowser().from("198.51.100.77")
                    .post("/auth/email/start", "{\"email\":\"q" + i + "@correo.co\"}");
            assertThat(r.status()).isEqualTo(204);
        }
        for (int i = 0; i < 12; i++) assertThat(start("p" + i + "@correo.co").status()).isEqualTo(204);   // one device
        assertThat(emails.sent()).hasSize(37);
    }

    @Test
    void signingInAgainWithinAMinuteSendsAFreshCode() {
        // A used code never blocks the next one: sign in, sign out, sign in again at once.
        start("ana@correo.co");
        assertThat(verify("ana@correo.co", emails.lastCodeFor("ana@correo.co")).status()).isEqualTo(200);
        api.post("/auth/sign-out", null);
        clock.advance(Duration.ofSeconds(5));
        start("ana@correo.co");
        assertThat(emails.sent()).hasSize(2);
        assertThat(verify("ana@correo.co", emails.lastCodeFor("ana@correo.co")).status()).isEqualTo(200);
    }

    @Test
    void signingInWhileSignedInEndsTheOldSessionUnderTheCeiling() {
        start("ana@correo.co");
        verify("ana@correo.co", emails.lastCodeFor("ana@correo.co"));
        String first = api.cookie("__Host-session").orElseThrow();
        clock.advance(Duration.ofMinutes(2));
        start("ana@correo.co");
        ApiResponse again = verify("ana@correo.co", emails.lastCodeFor("ana@correo.co"));   // lookup + DELETE on top
        assertThat(again.status()).isEqualTo(200);
        assertThat(api.cookie("__Host-session")).isPresent().get().isNotEqualTo(first);
        ApiClient old = clients.newBrowser();
        old.setCookie("__Host-session", first);
        assertThat(old.get("/session").status()).isEqualTo(401);
    }

    @Test
    void codesAreStoredAsAKeyedHashNotAPlainOne() {
        start("ana@correo.co");
        String code = emails.lastCodeFor("ana@correo.co");
        String stored = db.select(EMAIL_CODE.CODE_HASH).from(EMAIL_CODE).fetchOne().value1();
        assertThat(stored).matches("^[0-9a-f]{64}$").isNotEqualTo(co.scuby.platform.crypto.Hashing.sha256Hex("ana@correo.co:" + code));
    }

    @Test
    void theTestDomainUsesTheFixedCode() {
        start("e2e-1@e2e.scuby.test");
        assertThat(verify("e2e-1@e2e.scuby.test", "123456").status()).isEqualTo(200);
    }

    @Test
    void aTestDomainAddressSkipsTheCooldownAndEveryCapAndIsAlwaysRewritten() {
        // Test bypass (design · Test bypasses): e2e specs sign the same address in again and again within seconds.
        for (int round = 0; round < 12; round++) {
            assertThat(start("ana@e2e.scuby.test").status()).isEqualTo(204);
            assertThat(clients.newBrowser().post("/auth/email/verify",
                    "{\"email\":\"ana@e2e.scuby.test\",\"code\":\"123456\"}").status()).isEqualTo(200);
        }
        assertThat(db.fetchCount(CODE_SEND)).isZero();   // bypassed starts write no throttle rows
    }

    @Test
    void aBodyTheContractRejectsNamesTheField() {
        ApiResponse r = api.post("/auth/email/verify", "{\"email\":\"no-arroba\",\"code\":\"12\"}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("email")).isTrue();
        assertThat(r.json().at("/error/fields").has("code")).isTrue();
    }

    @Test
    void anAddressWithNonAsciiLettersIsOneAccountWhateverItsCase() {
        assertThat(start("ÁNA@Correo.co").status()).isEqualTo(204);
        String code = emails.lastCodeFor("áNA@correo.co".toLowerCase(java.util.Locale.ROOT));
        ApiResponse first = verify("ÁNA@CORREO.CO", code);
        assertThat(first.status()).isEqualTo(200);
        assertThat(first.str("/email")).isEqualTo("\u00e1na@correo.co");
        clock.advance(Duration.ofMinutes(2));
        start("\u00e1na@correo.co");
        ApiResponse second = clients.newBrowser().post("/auth/email/verify",
                "{\"email\":\"\u00c1na@correo.co\",\"code\":\"" + emails.lastCodeFor("\u00e1na@correo.co") + "\"}");
        assertThat(second.status()).isEqualTo(200);
        assertThat(second.str("/id")).isEqualTo(first.str("/id"));
        assertThat(db.fetchCount(PERSON)).isEqualTo(1);
    }

    @Test
    void aTestDomainAddressSignsInTwiceWithinSixtySeconds() {
        start("e2e-2@e2e.scuby.test");
        assertThat(verify("e2e-2@e2e.scuby.test", "123456").status()).isEqualTo(200);
        start("e2e-2@e2e.scuby.test");
        assertThat(clients.newBrowser().post("/auth/email/verify",
                "{\"email\":\"e2e-2@e2e.scuby.test\",\"code\":\"123456\"}").status()).isEqualTo(200);
    }

    @Test
    void aWrongCodeOnATestDomainStillCostsAnAttempt() {
        start("e2e-3@e2e.scuby.test");
        for (int i = 0; i < 3; i++) assertThat(verify("e2e-3@e2e.scuby.test", "999999").errorCode()).isEqualTo("invalid_code");
        assertThat(verify("e2e-3@e2e.scuby.test", "123456").errorCode()).isEqualTo("invalid_code");
        start("e2e-3@e2e.scuby.test");   // rewritten: works again
        assertThat(verify("e2e-3@e2e.scuby.test", "123456").status()).isEqualTo(200);
    }

    @Test
    void anAddressLongerThanTheRfcLimitIsRejectedWithTheField() {
        String longEmail = "a".repeat(250) + "@b.co";   // 255 chars
        ApiResponse r = start(longEmail);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("email")).isTrue();
        assertThat(start("a".repeat(248) + "@b.co").status()).isEqualTo(204);   // 253 chars is fine
    }

    @Test
    void aDottedCapitalIWithDotAbovePassesThroughJavaAndTheDbCheckWithoutA500() {
        // U+0130 lower-cases (Locale.ROOT) to "i" + U+0307; the DB CHECK email = lower(btrim(email)) must agree.
        String address = "\u0130van@correo.co";
        assertThat(start(address).status()).isEqualTo(204);   // Java and the DB CHECK agree: no constraint violation
        String stored = db.select(EMAIL_CODE.EMAIL).from(EMAIL_CODE).fetchOne().value1();
        assertThat(stored).isEqualTo(EmailSignIn.normalize(address));
        assertThat(verify(address, emails.lastCodeFor(stored)).status()).isEqualTo(200);
    }

    @Test
    void onlyExpiredEmailCodesArePurgedSendCountsLiveInTheSendLog() {
        start("old@correo.co");
        clock.advance(Duration.ofMinutes(10));   // old@ has expired
        start("live@correo.co");
        assertThat(codes.purgeStale()).isEqualTo(1);
        assertThat(db.select(EMAIL_CODE.EMAIL).from(EMAIL_CODE).fetch(EMAIL_CODE.EMAIL)).containsExactly("live@correo.co");
        assertThat(db.fetchCount(CODE_SEND)).isEqualTo(2);   // the cap's counter is untouched
    }
}
