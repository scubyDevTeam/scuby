package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * Recovery-claim rules (docs/product/04-lost-workflow.md · recovery_claim; L1 design §3, §4.9, §4.10). Pure.
 * A claim is stale when it is still open 7 days after the claimant's last «Lo tengo» on it (last_active_at: the insert,
 * or a repeat that refreshed it); stale is derived, never stored. The badge is
 * owner-only: «a claim must never reduce reach» (04 · Rule: a recovery claim must never reduce reach), and a public
 * «Posible hallazgo» tells helpers the search may be over.
 */
final class ClaimDerivation {

    /** Stale iff lastActiveAt + 7 d is before now (strict); SQL non-stale: last_active_at >= now − 7 d. */
    static final Duration STALE_AFTER = Duration.ofDays(7);
    /** A pin prefills a claim when created within 24 h, exclusive; SQL created_at > now − 24 h. */
    static final Duration PREFILL_WINDOW = Duration.ofHours(24);

    private static final Set<String> ANSWERS = Set.of("confirmed", "dismissed");

    /** The publisher's contact preferences, as stored on the case. */
    record ContactFlags(boolean exposeWhatsapp, boolean phoneHasWhatsapp, boolean contactPhoneVerified, boolean inAppOnly) {}

    /** The pin a claim says it grew out of (from_sighting_id). */
    record SightingLink(String status, @Nullable UUID reporterPersonId, String reporterDeviceHash, Instant createdAt) {}

    private ClaimDerivation() {}

    static boolean isStale(String storedStatus, Instant lastActiveAt, Instant now) {
        return "open".equals(storedStatus) && lastActiveAt.plus(STALE_AFTER).isBefore(now);
    }

    /** The contract's claim status: the stored one, or `stale` for an open claim idle past STALE_AFTER. */
    static String wireStatus(String storedStatus, Instant lastActiveAt, Instant now) {
        return isStale(storedStatus, lastActiveAt, now) ? "stale" : storedStatus;
    }

    static Instant staleCutoff(Instant now) {
        return now.minus(STALE_AFTER);
    }

    static Instant prefillCutoff(Instant now) {
        return now.minus(PREFILL_WINDOW);
    }

    /** open_claim_count on a case view: null for a non-owner (not even queried), 0 off `active`. */
    static @Nullable Integer openClaimCount(boolean owner, String caseStatus, int openNonStale) {
        if (!owner) return null;
        return "active".equals(caseStatus) ? openNonStale : 0;
    }

    static boolean isAnswer(@Nullable String value) {
        return value != null && ANSWERS.contains(value);
    }

    /** Repeating the current answer is a no-op; confirmed ↔ dismissed may change at any time. */
    static boolean answerChanges(String storedStatus, String requested) {
        return !storedStatus.equals(requested);
    }

    /**
     * Whether a claim keeps its from_sighting_id link: the pin is on this case (the caller's query guarantees it), visible,
     * the claimant's own ({@code mine}, from LostCaseDerivation.mine: their person, or an anonymous pin from their device),
     * and created within PREFILL_WINDOW. An ineligible pin is ignored (the claim is stored without the link), never refused.
     */
    static boolean prefillEligible(SightingLink pin, boolean mine, Instant now) {
        return "visible".equals(pin.status()) && mine && pin.createdAt().isAfter(prefillCutoff(now));
    }

    /** The owner's number for the claimant's WhatsApp link, only under the public-contact rule on an active case. */
    static @Nullable String whatsappPhone(ContactFlags flags, String caseStatus, @Nullable String contactPhone) {
        boolean publicContact = flags.exposeWhatsapp() && flags.phoneHasWhatsapp() && flags.contactPhoneVerified() && !flags.inAppOnly();
        return publicContact && "active".equals(caseStatus) ? contactPhone : null;
    }

    /** Spanish for every locale: the owner reads it and no owner language is stored (spec assumption 13). */
    static String whatsappText(@Nullable String petName, String code) {
        String about = petName == null || petName.isBlank() ? "" : " de " + petName.strip();
        return "Hola, vi tu aviso" + about + " en Scuby (" + code + ") y creo que lo tengo.";
    }
}
