package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Caller;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;

@Component
class FeedReads {

    private final FeedQueries queries;
    private final FeedProperties properties;
    private final Clock clock;

    FeedReads(FeedQueries queries, FeedProperties properties, Clock clock) {
        this.queries = queries;
        this.properties = properties;
        this.clock = clock;
    }

    FeedView feed(FeedQuery query, Caller caller, Locale locale) {
        if (query.vertical() != null && query.vertical() != Vertical.lost) {
            return FeedDerivation.derive(List.of(), FeedDerivation.Scope.national, locale);
        }
        String species = query.species() == null ? null : query.species().name();
        Instant now = clock.instant();
        if (query.lat() != null && query.lng() != null) {
            List<FeedRow> near = queries.fetch(queries.localQuery(new GeoPoint(query.lat(), query.lng()), species,
                    properties.nearRadiusM(), properties.maxItems(), caller.personId(), now));
            if (!near.isEmpty()) return FeedDerivation.derive(near, FeedDerivation.Scope.local, locale);
        }
        return FeedDerivation.derive(queries.fetch(queries.nationalQuery(species, properties.maxItems(), caller.personId(), now)),
                FeedDerivation.Scope.national, locale);
    }
}
