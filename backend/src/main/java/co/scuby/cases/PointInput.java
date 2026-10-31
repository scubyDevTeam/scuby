package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

/** A wire point `{lat, lng}` (web/src/contracts/primitives.ts). */
record PointInput(@NotNull @DecimalMin("-90") @DecimalMax("90") Double lat,
                  @NotNull @DecimalMin("-180") @DecimalMax("180") Double lng) {
    GeoPoint toGeoPoint() {
        return new GeoPoint(lat, lng);
    }
}
