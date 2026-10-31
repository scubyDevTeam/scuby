package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;

import java.util.Optional;

/** Reverse geocoding: the barrio a point is in (docs/product/10-sharing.md). Provider chosen by the place-names spike. */
@FunctionalInterface
interface PlaceNamer {
    Optional<String> nameFor(GeoPoint point);
}
