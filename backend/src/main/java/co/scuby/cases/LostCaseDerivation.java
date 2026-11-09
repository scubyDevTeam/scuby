package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Facts + viewer + time → the LostCase response (design · Responses: facts → derivation → record).
 * Pure: no clock, no security context, no I/O.
 */
final class LostCaseDerivation {

    static final double PUBLIC_RADIUS_FLOOR_M = 200;
    static final Duration EDIT_WINDOW = Duration.ofMinutes(15);

    private LostCaseDerivation() {}

    static LostCaseView derive(LostCaseFacts facts, Viewer viewer, Instant now, Locale locale) {
        boolean owner = viewer.access() == Access.OWNER;
        var pet = facts.pet();
        List<LostCaseView.SightingView> sightings = facts.sightings().stream()
                .filter(s -> owner || !s.hidden())
                .sorted(Comparator.comparing(LostCaseFacts.SightingFacts::seenAt).thenComparing(LostCaseFacts.SightingFacts::id))
                .map(s -> sighting(s, viewer, owner, now))
                .toList();
        return new LostCaseView(
                facts.code(), "lost", facts.status(), facts.resolvedAt(), owner ? "owner" : "public",
                new LostCaseView.PetView(pet.name() == null ? "" : pet.name(), pet.species(), pet.size(),
                        pet.colors(), pet.marks(), pet.photoUrls()),
                new LostCaseView.LastSeenView(owner ? facts.center() : LocationPrecisionDerivation.publicCenter(facts.center()),
                        owner ? facts.radiusM() : Math.max(facts.radiusM(), PUBLIC_RADIUS_FLOOR_M),
                        facts.lastSeenAt(), PublicTextDerivation.placeName(facts.placeName(), locale)),
                ClaimDerivation.openClaimCount(owner, facts.status(), facts.claims() == null ? 0 : facts.claims().openNonStale()),
                sightings, claims(facts, owner, now), null, contact(facts, locale));
    }

    private static LostCaseView.SightingView sighting(LostCaseFacts.SightingFacts s, Viewer viewer, boolean owner, Instant now) {
        boolean mine = mine(viewer.personId(), viewer.deviceHash(), s.reporterPersonId(), s.reporterDeviceHash());
        Instant editableUntil = editable(mine, !s.hidden(), s.createdAt(), now) ? s.createdAt().plus(EDIT_WINDOW) : null;
        return new LostCaseView.SightingView(s.id().toString(), s.point(), s.seenAt(), s.note(), s.photoUrls(),
                s.reporterPersonId() != null ? "registered" : "anonymous", s.highlighted(),
                owner ? s.contactPhone() : null, owner && s.hidden(), mine, editableUntil);
    }

    /**
     * "Mine" (docs/eng/api.md · Device identity): the pin's reporter is the caller's person, or the pin has no person and
     * came from the caller's device. Another person's pin is never mine, whatever device sent it; an anonymous pin from
     * this browser stays mine after its reporter signs in (they may sign in to say «Lo tengo» and keep their pin).
     */
    static boolean mine(@Nullable UUID viewerPerson, String viewerDevice, @Nullable UUID reporterPerson, String reporterDevice) {
        return (viewerPerson != null && viewerPerson.equals(reporterPerson))
                || (reporterPerson == null && viewerDevice.equals(reporterDevice));
    }

    /** Correctable and deletable by its reporter: mine, visible, and now before created_at + 15 min (exclusive). */
    static boolean editable(boolean mine, boolean visible, Instant createdAt, Instant now) {
        return mine && visible && now.isBefore(createdAt.plus(EDIT_WINDOW));
    }

    private static LostCaseView.@Nullable ContactView contact(LostCaseFacts facts, Locale locale) {
        if (!"active".equals(facts.status())) return null;
        String whatsapp = facts.whatsappPhone() == null ? null : PublicTextDerivation.whatsappUrl(facts.whatsappPhone());
        return new LostCaseView.ContactView(PublicTextDerivation.publicName(facts.publisherName(), locale), whatsapp);
    }

    /** Owner only, in the query's order (latest activity first; the wire created_at is last_active_at, decision 18); a non-owner gets [] whatever the facts hold. */
    private static List<LostCaseView.ClaimView> claims(LostCaseFacts facts, boolean owner, Instant now) {
        if (!owner || facts.claims() == null) return List.of();
        return facts.claims().newest().stream()
                .map(c -> new LostCaseView.ClaimView(c.id().toString(), c.phone(), c.lastActiveAt(),
                        ClaimDerivation.wireStatus(c.status(), c.lastActiveAt(), now)))
                .toList();
    }
}
