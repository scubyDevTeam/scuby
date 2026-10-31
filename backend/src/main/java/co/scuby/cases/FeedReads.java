package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;

@Component
class FeedReads {

    private final FeedQueries queries;
    private final FeedProperties properties;

    FeedReads(FeedQueries queries, FeedProperties properties) {
        this.queries = queries;
        this.properties = properties;
    }

    FeedView feed(FeedQuery query, Locale locale) {
        if (query.vertical() != null && query.vertical() != Vertical.lost) {
            return FeedDerivation.derive(List.of(), FeedDerivation.Scope.national, locale);
        }
        String species = query.species() == null ? null : query.species().name();
        if (query.lat() != null && query.lng() != null) {
            List<FeedRow> near = queries.fetch(queries.localQuery(new GeoPoint(query.lat(), query.lng()), species,
                    properties.nearRadiusM(), properties.maxItems()));
            if (!near.isEmpty()) return FeedDerivation.derive(near, FeedDerivation.Scope.local, locale);
        }
        return FeedDerivation.derive(queries.fetch(queries.nationalQuery(species, properties.maxItems())),
                FeedDerivation.Scope.national, locale);
    }
}
