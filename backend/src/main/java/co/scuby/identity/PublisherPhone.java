package co.scuby.identity;

import co.scuby.platform.flags.FeatureFlags;
import co.scuby.platform.flags.Flag;
import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

/**
 * The phone step of every publish (docs/eng/auth.md · UI contract — the phone step), in two calls because a code
 * attempt must be counted before the publish's transaction opens (see PhoneOtp.reserveAndCheck):
 * <ol>
 *   <li>{@link #prepare}, with NO transaction open: validates the number and, when a code was given for a number
 *       that needs one, reserves the attempt (a wrong code is {@code invalid_code} right here);</li>
 *   <li>{@link #resolve}, INSIDE the publish's transaction and after the publish's own validation (fields,
 *       photos, {@code active_case_exists}): stores the code to send, stores the number, or, for a reserved
 *       code, says it is still to be consumed ({@link Ready#pendingCode});</li>
 *   <li>{@link #confirm}, in the same transaction, AFTER the caller's own write succeeded (the case insert):
 *       consumes that code. A publish that is refused or loses the one-active-case race never reaches it, so a
 *       right code stays usable (its attempt stays spent), and a double tap with the same code waits on the
 *       case's unique index and gets {@code active_case_exists}, not {@code invalid_code};</li>
 *   <li>{@link #deliver}, AFTER the publish's transaction returned (no connection held): sends the SMS of a
 *       {@link CodeSent}.</li>
 * </ol>
 * Identity stays the only writer of `person` and `phone_otp`.
 */
@ModuleApi
@Component
public class PublisherPhone {

    public sealed interface Outcome permits Ready, CodeSent {}

    /** Publish with this number; {@code verified} is false only with publisher_phone_otp off (O24). */
    public record Ready(String phone, boolean verified, PhoneOtp.@Nullable Reservation pendingCode) implements Outcome {
        public Ready(String phone, boolean verified) {
            this(phone, verified, null);
        }
    }

    /**
     * A code was stored (or the number is inside its cooldown, so nothing is pending to send): answer
     * `{phone_step: "otp"}`, write nothing else, and pass this to {@link #deliver} once the transaction is over.
     */
    public static final class CodeSent implements Outcome {
        private final PhoneOtp.@Nullable Outgoing outgoing;

        private CodeSent(PhoneOtp.@Nullable Outgoing outgoing) {
            this.outgoing = outgoing;
        }
    }

    /** Result of {@link #prepare}: pass it, unchanged, to {@link #resolve}. Opaque. */
    public static final class Prepared {
        private final UUID personId;
        private final @Nullable String bodyPhone;
        private final boolean codeGiven;
        private final PhoneOtp.@Nullable Reservation reservation;

        private Prepared(UUID personId, @Nullable String bodyPhone, boolean codeGiven, PhoneOtp.@Nullable Reservation reservation) {
            this.personId = personId;
            this.bodyPhone = bodyPhone;
            this.codeGiven = codeGiven;
            this.reservation = reservation;
        }
    }

    private final People people;
    private final PhoneNumbers numbers;
    private final PhoneOtp otp;
    private final FeatureFlags flags;
    private final Clock clock;

    PublisherPhone(People people, PhoneNumbers numbers, PhoneOtp otp, FeatureFlags flags, Clock clock) {
        this.people = people;
        this.numbers = numbers;
        this.otp = otp;
        this.flags = flags;
        this.clock = clock;
    }

    /** Throws phone_required, validation_failed on `phone`, or invalid_code; sends nothing. */
    @Transactional(propagation = Propagation.NEVER)
    public Prepared prepare(UUID personId, @Nullable String bodyPhone, @Nullable String otpCode) {
        Person person = people.get(personId);
        String target = target(person, bodyPhone);
        PhoneOtp.Reservation reservation = null;
        if (otpCode != null && decide(person, target, true) == PhoneStepDerivation.Step.CHECK_CODE) {
            reservation = otp.reserveAndCheck(personId, target, otpCode)
                             .orElseThrow(() -> new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code"));
        }
        return new Prepared(personId, bodyPhone, otpCode != null, reservation);
    }

    /**
     * Must run in the publish's transaction. {@code rate_limited} (from the code store) and {@code invalid_code}
     * must propagate out of that transaction: either one leaves it rollback-only, so catching it and carrying on
     * ends in an UnexpectedRollbackException. The SMS itself goes out in {@link #deliver}, after that transaction.
     * No row lock: the caller's own constraints (the unique active case per pet) arbitrate races.
     *
     * @throws IllegalArgumentException when {@code caller} is not the account {@code prepared} was made for
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Outcome resolve(Prepared prepared, Caller caller) {
        UUID personId = prepared.personId;
        if (!personId.equals(caller.personId())) {
            throw new IllegalArgumentException("the phone step was prepared for another account");
        }
        Person person = people.get(personId);
        String target = target(person, prepared.bodyPhone);
        return switch (decide(person, target, prepared.codeGiven)) {
            case USE_VERIFIED -> new Ready(target, true);
            case SEND_CODE -> {
                yield new CodeSent(otp.store(personId, target));
            }
            case CHECK_CODE -> {
                // The code was reserved for one number: it verifies that number only (the stored number may
                // have changed between prepare and resolve).
                if (prepared.reservation == null || !prepared.reservation.isFor(target)) {
                    throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
                }
                people.setPhone(personId, target, clock.instant());
                yield new Ready(target, true, prepared.reservation);
            }
            case STORE_UNVERIFIED -> {
                if (!target.equals(person.phone()) || person.phoneVerifiedAt() != null) people.setPhone(personId, target, null);
                yield new Ready(target, false);
            }
        };
    }

    /**
     * Consumes the code a {@link Ready} still holds (a no-op when it holds none). Call it in the resolving
     * transaction once the publish's own write is in; {@code invalid_code} rolls that transaction back.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void confirm(Ready ready) {
        if (ready.pendingCode() != null && !otp.consume(ready.pendingCode())) {
            throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
        }
    }

    /** Sends the SMS of a {@link CodeSent}. Call it after the transaction that produced it has returned: no network call holds a connection. */
    public void deliver(CodeSent sent) {
        if (sent.outgoing != null) otp.deliver(sent.outgoing);
    }

    private String target(Person person, @Nullable String bodyPhone) {
        String target = bodyPhone != null ? numbers.requireMobile(bodyPhone, "phone") : person.phone();
        if (target == null) throw new ApiException(ErrorCode.PHONE_REQUIRED, "a phone number is required to publish");
        return target;
    }

    private PhoneStepDerivation.Step decide(Person person, String target, boolean codeGiven) {
        boolean otpOn = flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, person.id());
        return PhoneStepDerivation.decide(otpOn, person.phone(), person.phoneVerifiedAt() != null, target, codeGiven);
    }
}
