package co.scuby.cases;

import java.util.List;
import java.util.Locale;

/**
 * The caller's case rows (already ordered newest first) → MyCases items. Pure. No claims and no
 * check-ins exist in this slice: open_claim_count 0, pending_checkin_at null.
 */
final class MyCasesDerivation {

    private MyCasesDerivation() {}

    static List<MyCaseView> derive(List<MyCaseRow> rows, Locale locale) {
        return rows.stream().map(r -> new MyCaseView(
                r.code(), "lost", r.status(),
                r.petName() != null ? r.petName() : PublicTextDerivation.lookTitle(r.species(), r.size(), r.colors(), locale),
                PublicTextDerivation.placeName(r.placeName(), locale), r.firstPhotoUrl(), r.publishedAt(),
                0, null)).toList();
    }
}
