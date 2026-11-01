package co.scuby.cases;

import co.scuby.cases.LostLifecycleDerivation.Action;
import co.scuby.cases.LostLifecycleDerivation.Outcome;
import co.scuby.identity.PhoneNumbers;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.db.UniqueViolation;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.BodyValidation;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * «Lo tengo» (docs/product/04-lost-workflow.md · recovery_claim; L1 design §4.9). Order: the code exists (not_found; a
 * purged one gone) → the caller is not the owner (forbidden) → the body: phone, photo count, then the photos (S3 in
 * staging: outside any transaction) → the status. from_sighting_id is a link, never an error: kept (with the pin's point)
 * only when it is the caller's own visible pin on this case from the last 24 h, else dropped. Then one transaction: the
 * reactivation of an expired case (decision #29; zero rows is not an error, a concurrent claim may have done it) and the
 * one-statement upsert, which inserts the claim or refreshes the caller's open one (a repeat). One claim per person per
 * case (decision #82): when the owner already answered the caller's claim, the pre-read says so and a repeat gets that claim
 * back with no write (no reactivation either). Empty upsert → the transaction is rolled back and a re-read says why
 * (invalid_transition, active_case_exists) or, when the owner answered in between, hands the answered claim back: an old
 * claim is never answered on a case that is not active. Only the pet's newest case is reactivated (decision #81). No rate limit (as #54), no notification, no check-in, no outbox row (L2 derives them from rows).
 */
@Service
class RecoveryClaimService {

    private final RecoveryClaimQueries queries;
    private final LifecycleQueries lifecycle;
    private final LostCaseQueries cases;
    private final CaseAccessPolicy policy;
    private final OwnerAccess owners;
    private final PhoneNumbers phones;
    private final PhotoAttachments photos;
    private final BodyValidation validation;
    private final TransactionTemplate tx;
    private final Clock clock;

    RecoveryClaimService(RecoveryClaimQueries queries, LifecycleQueries lifecycle, LostCaseQueries cases, CaseAccessPolicy policy, OwnerAccess owners,
                         PhoneNumbers phones, PhotoAttachments photos, BodyValidation validation, TransactionTemplate tx, Clock clock) {
        this.queries = queries;
        this.lifecycle = lifecycle;
        this.cases = cases;
        this.policy = policy;
        this.owners = owners;
        this.phones = phones;
        this.photos = photos;
        this.validation = validation;
        this.tx = tx;
        this.clock = clock;
    }

    ClaimCreatedView claim(String rawCode, Account account, Caller caller, RecoveryClaimRequest body) {
        String code = OwnerAccess.code(rawCode);
        UUID me = account.personId();
        Instant now = clock.instant();
        RecoveryClaimQueries.ClaimCase found = queries.caseForClaim(code, me)
                .orElseThrow(() -> cases.isPurged(code) ? CaseErrors.gone() : CaseErrors.notFound());
        if (policy.isOwner(found.createdBy(), me)) throw CaseErrors.forbidden("the owner cannot claim their own case");

        if (body.phone() == null) throw CaseErrors.invalidField("phone", "required");
        String phone = phones.requireMobile(body.phone(), "phone");
        validation.require(body);
        Optional<RecoveryClaimQueries.PinForClaim> link = linkedPin(code, body.fromSightingId(), caller, now);
        photos.requireAttachable(body.photos(), UploadPurpose.claim, caller, "photo_urls");

        Outcome outcome = LostLifecycleDerivation.check(Action.CLAIM, found.status(), found.resolvedAt(), now);
        if (outcome == Outcome.INVALID_TRANSITION) throw CaseErrors.invalidTransition();
        if (found.answered()) return view(found.own().id(), found.activePhone(), found.petName(), code);   // decision #82: no write
        GeoPoint claimPoint = link.map(RecoveryClaimQueries.PinForClaim::point).orElse(null);
        UUID claimFrom = link.isPresent() ? UUID.fromString(body.fromSightingId()) : null;
        Optional<UUID> written;
        try {
            written = tx.execute(status -> {
                if (outcome == Outcome.REACTIVATE) lifecycle.reopen(code, null, now);
                Optional<UUID> id = queries.upsertIfActive(code, me, phone, body.photos(), claimPoint, claimFrom, now);
                if (id.isEmpty()) status.setRollbackOnly();   // nothing was claimed: a reactivation alone must not stay
                return id;
            });
        } catch (RuntimeException e) {
            if (!UniqueViolation.on(e, LifecycleQueries.ACTIVE_PER_PET)) throw e;
            // The other active case was closed again between the violation and this read: the case is still not active.
            throw lifecycle.activeCodeFor(found.petId()).map(CaseErrors::activeCaseExists).orElseGet(CaseErrors::invalidTransition);
        }
        if (written.isEmpty()) return afterEmptyWrite(code, me, now);
        // A row came back, so the case was active when it was written: the link follows the contact rule on an active case.
        return view(written.get(), found.publicPhone(), found.petName(), code);
    }

    private static ClaimCreatedView view(UUID id, @Nullable String phone, @Nullable String petName, String code) {
        return new ClaimCreatedView(id.toString(), phone == null ? null : WhatsappLinks.withText(phone, ClaimDerivation.whatsappText(petName, code)));
    }

    /**
     * The owner's verdict (L1 design §4.10). Order: case not_found → forbidden → the claim is on this case (not_found) → the
     * body. Any case status (a purged case has no row: not_found). Revisable; repeating the stored answer writes nothing.
     * Confirming never closes the case (only reunite does) and leaves the other claims as they are.
     */
    CreatedView answer(String rawCode, String rawClaimId, UUID me, ClaimAnswerRequest body) {
        String code = OwnerAccess.code(rawCode);
        RecoveryClaimQueries.AnswerTarget target = owners.require(queries.answerTarget(code, OwnerAccess.id(rawClaimId)),
                RecoveryClaimQueries.AnswerTarget::createdBy, me);
        if (target.claimId() == null) throw CaseErrors.notFound("claim");
        if (!ClaimDerivation.isAnswer(body.status())) throw CaseErrors.invalidField("status", "confirmed or dismissed");
        if (ClaimDerivation.answerChanges(target.claimStatus(), body.status())) queries.answer(code, target.claimId(), body.status(), clock.instant());
        return new CreatedView(target.claimId().toString());
    }

    /**
     * The pin the claim grew out of, when it is the caller's own (LostCaseDerivation.mine: their person, or an anonymous pin
     * from their device), visible, on this case and from the last 24 h; empty otherwise — absent, not a UUID, unknown, or
     * ineligible. Never an error: the claim is what matters, the link is attribution.
     */
    private Optional<RecoveryClaimQueries.PinForClaim> linkedPin(String code, @Nullable String rawId, Caller caller, Instant now) {
        if (rawId == null) return Optional.empty();
        return OwnerAccess.id(rawId).flatMap(id -> queries.pin(code, id)).filter(pin -> ClaimDerivation.prefillEligible(pin.link(),
                LostCaseDerivation.mine(caller.personId(), caller.deviceHash(), pin.link().reporterPersonId(), pin.link().reporterDeviceHash()),
                now));
    }

    /**
     * Nothing written: the case is not active (and could not be reactivated), or the owner answered the caller's claim since
     * the read. Say why, or hand the answered claim back.
     */
    private ClaimCreatedView afterEmptyWrite(String code, UUID me, Instant now) {
        RecoveryClaimQueries.ClaimCase fresh = queries.caseForClaim(code, me).orElseThrow(CaseErrors::notFound);
        if (LostLifecycleDerivation.check(Action.CLAIM, fresh.status(), fresh.resolvedAt(), now) == Outcome.INVALID_TRANSITION) {
            throw CaseErrors.invalidTransition();
        }
        if (fresh.otherActiveCode() != null) throw CaseErrors.activeCaseExists(fresh.otherActiveCode());
        if (fresh.answered()) return view(fresh.own().id(), fresh.activePhone(), fresh.petName(), code);
        // Otherwise the case is no longer claimable: an older case of the pet (only the newest is reactivated), or it expired
        // between the pre-read and the write (nothing expires cases in L1; the L2 expiry job should retry or reactivate here).
        throw CaseErrors.invalidTransition();
    }
}
