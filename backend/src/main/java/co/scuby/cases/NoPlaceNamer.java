package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.springframework.stereotype.Component;

import java.util.Optional;

/** No provider is wired in this slice: even with reverse_geocoding on, the generic label renders. */
@Component
class NoPlaceNamer implements PlaceNamer {
    @Override
    public Optional<String> nameFor(GeoPoint point) {
        return Optional.empty();
    }
}
