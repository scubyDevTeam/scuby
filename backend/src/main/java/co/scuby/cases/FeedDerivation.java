package co.scuby.cases;

import java.util.List;
import java.util.Locale;

/** Feed rows (already ordered and capped by the query) → the contract's Feed. Pure. possible_find is computed by the query, owner-only (FeedQueries.possibleFind). The feed is a public view: the row's center is already the snapped one (the query reads last_seen_public_*, decision 69). */
final class FeedDerivation {

    enum Scope { local, national }

    private FeedDerivation() {}

    static FeedView derive(List<FeedRow> rows, Scope scope, Locale locale) {
        return new FeedView(scope.name(), rows.stream().map(r -> new FeedView.FeedItem(
                r.code(), "lost", r.petName() == null ? "" : r.petName(), r.species(),
                PublicTextDerivation.summary(r.species(), r.size(), r.colors(), locale),
                PublicTextDerivation.placeName(r.placeName(), locale), r.center(), r.firstPhotoUrl(),
                r.lastSeenAt(), r.possibleFind(), r.sightingsCount(), r.lastSightingAt(), null)).toList());
    }
}
