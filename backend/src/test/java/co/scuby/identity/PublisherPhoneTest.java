package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.support.Accounts;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PHONE_OTP;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class PublisherPhoneTest {

    static final String PHONE = "+573007152284";

    @Autowired PublisherPhone publisherPhone;
    @Autowired Accounts accounts;
    @Autowired TestDb testDb;
    @Autowired RecordingSmsSender sms;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;

    UUID ana;
    Caller caller;

    @BeforeEach
    void setUp() {
        testDb.reset();
        ana = accounts.person("ana.gomez@correo.co");
        caller = new Caller(ana, "d".repeat(64), "i".repeat(64));
    }

    /** What the publish does: reserve any code attempt first (no transaction), then resolve inside its transaction. */
    private PublisherPhone.Outcome resolve(String phone, String code) {
        PublisherPhone.Prepared prepared = publisherPhone.prepare(ana, phone, code);
        return tx.execute(s -> publisherPhone.resolve(prepared, caller));
    }

    private String codeOf(ApiException e) {
        return (String) e.getBody().getProperties().get("code");
    }

    @Test
    void aNewNumberGetsACodeThenTheRightCodeVerifiesIt() {
        assertThat(resolve(PHONE, null)).isInstanceOf(PublisherPhone.CodeSent.class);
        assertThat(sms.sent()).hasSize(1);
        assertThat(resolve(PHONE, sms.lastCodeFor(PHONE))).isEqualTo(new PublisherPhone.Ready(PHONE, true));
        var person = db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne();
        assertThat(person.getPhone()).isEqualTo(PHONE);
        assertThat(person.getPhoneVerifiedAt()).isNotNull();
        assertThat(resolve(null, null)).isEqualTo(new PublisherPhone.Ready(PHONE, true));   // later publishes: no SMS
        assertThat(sms.sent()).hasSize(1);
    }

    @Test
    void repeatingTheFirstCallInsideTheCooldownAnswersCodeSentWithoutResending() {
        resolve(PHONE, null);
        clock.advance(Duration.ofSeconds(30));
        assertThat(resolve(PHONE, null)).isInstanceOf(PublisherPhone.CodeSent.class);
        assertThat(sms.sent()).hasSize(1);
    }

    @Test
    void aWrongCodeIsInvalidAndTheAttemptSurvivesTheRollback() {
        resolve(PHONE, null);
        String wrong = sms.lastCodeFor(PHONE).equals("000000") ? "111111" : "000000";
        assertThatThrownBy(() -> resolve(PHONE, wrong))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(codeOf(e)).isEqualTo("invalid_code"));
        assertThat(db.select(PHONE_OTP.ATTEMPTS).from(PHONE_OTP).fetchOne().value1()).isEqualTo(1);
    }

    @Test
    void aRightCodeSurvivesAPublishThatRollsBackAfterThePhoneStep() {
        resolve(PHONE, null);
        String code = sms.lastCodeFor(PHONE);
        PublisherPhone.Prepared prepared = publisherPhone.prepare(ana, PHONE, code);
        assertThatThrownBy(() -> tx.execute(s -> {
            publisherPhone.resolve(prepared, caller);
            throw new IllegalStateException("the publish failed after the phone step");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(resolve(PHONE, code)).isEqualTo(new PublisherPhone.Ready(PHONE, true));   // same code, still good
    }

    @Test
    void resolveOutsideATransactionIsAProgrammingError() {
        PublisherPhone.Prepared prepared = publisherPhone.prepare(ana, PHONE, null);
        assertThatThrownBy(() -> publisherPhone.resolve(prepared, caller))
                .isInstanceOf(org.springframework.transaction.IllegalTransactionStateException.class);
    }

    @Test
    void prepareInsideATransactionIsAProgrammingError() {
        assertThatThrownBy(() -> tx.execute(s -> publisherPhone.prepare(ana, PHONE, "123456")))
                .isInstanceOf(org.springframework.transaction.IllegalTransactionStateException.class);
    }

    @Test
    void noNumberAnywhereIsPhoneRequired() {
        assertThatThrownBy(() -> resolve(null, null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(codeOf(e)).isEqualTo("phone_required"));
    }

    @Test
    void aBadNumberIsValidationFailedOnPhoneBeforeAnySend() {
        assertThatThrownBy(() -> resolve("+5716012345", null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(codeOf(e)).isEqualTo("validation_failed"));
        assertThat(sms.sent()).isEmpty();
    }

    @Test
    void aStoredButUnverifiedNumberStillNeedsTheCodeWhenTheFlagIsOn() {
        db.update(PERSON).set(PERSON.PHONE, PHONE).where(PERSON.ID.eq(ana)).execute();
        assertThat(resolve(null, null)).isInstanceOf(PublisherPhone.CodeSent.class);
    }

    @Test
    void flagOffStoresTheNumberUnverifiedAndPublishes() {
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('publisher_phone_otp', ?, false, 'test')", ana);
        assertThat(resolve(PHONE, null)).isEqualTo(new PublisherPhone.Ready(PHONE, false));
        var person = db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne();
        assertThat(person.getPhone()).isEqualTo(PHONE);
        assertThat(person.getPhoneVerifiedAt()).isNull();
        assertThat(sms.sent()).isEmpty();
    }

    @Test
    void aReservationForOneNumberDoesNotVerifyAnother() {
        String other = "+573001234567";
        db.update(PERSON).set(PERSON.PHONE, PHONE).where(PERSON.ID.eq(ana)).execute();   // stored, unverified
        resolve(null, null);                                                              // sends a code to PHONE
        String code = sms.lastCodeFor(PHONE);
        PublisherPhone.Prepared prepared = publisherPhone.prepare(ana, null, code);       // reserves PHONE's code
        db.update(PERSON).set(PERSON.PHONE, other).where(PERSON.ID.eq(ana)).execute();   // the stored number moves on
        assertThatThrownBy(() -> tx.execute(s -> publisherPhone.resolve(prepared, caller)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(codeOf(e)).isEqualTo("invalid_code"));
        var person = db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne();
        assertThat(person.getPhone()).isEqualTo(other);
        assertThat(person.getPhoneVerifiedAt()).as("the other number must not become verified").isNull();
    }

    @Test
    void aPreparedPhoneStepCannotBeResolvedForAnotherCaller() {
        PublisherPhone.Prepared prepared = publisherPhone.prepare(ana, PHONE, null);
        Caller someoneElse = new Caller(UUID.randomUUID(), "d".repeat(64), "i".repeat(64));
        assertThatThrownBy(() -> tx.execute(s -> publisherPhone.resolve(prepared, someoneElse)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(sms.sent()).isEmpty();
    }
}
