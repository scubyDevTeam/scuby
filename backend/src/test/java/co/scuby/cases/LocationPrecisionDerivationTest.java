package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * The public last-seen center is snapped to a grid of about 200 m (docs/product/04 · Location precision, decision 63).
 * Human review: the table is the rule.
 */
class LocationPrecisionDerivationTest {

    @ParameterizedTest(name = "({0}, {1}) → ({2}, {3})")
    @CsvSource({
            // Medellín: the exact point of the mock's fixture lands on the grid node, a neighbour moves
            "6.2442,   -75.5812,  6.2442,   -75.580392",
            "6.2455,   -75.5905,  6.246,    -75.589705",
            "4.7110,   -74.0721,  4.7106,   -74.071799",
            // the longitude step grows with the latitude (about 200 m east-west everywhere)
            "51.5074,  -0.1278,   51.507,   -0.127245",
            "60.0001,  10.0,      59.9994,  10.000619",
            // the equator and the meridian: node (0, 0)
            "0.0,      0.0,       0.0,      0.0",
            "0.0004,   0.0004,    0.0,      0.0",
            // the poles and the antimeridian stay inside the valid range
            "89.9999,  179.9999,  90.0,     180.0",
            "-89.9999, -179.9999, -90.0,    -180.0",
    })
    void snapsToTheGridNodeNearestTheExactPoint(double lat, double lng, double snappedLat, double snappedLng) {
        GeoPoint snapped = LocationPrecisionDerivation.publicCenter(new GeoPoint(lat, lng));
        assertThat(snapped.lat()).isEqualTo(snappedLat);
        assertThat(snapped.lng()).isEqualTo(snappedLng);
    }

    @ParameterizedTest(name = "({0}, {1})")
    @CsvSource({"6.2442, -75.5812", "6.2455, -75.5905", "4.7110, -74.0721", "-33.4489, -70.6693", "64.1466, -21.9426", "0.0009, 0.0009"})
    void aPointIsAtMost150MetersFromItsSnappedCenterSoThe200mFloorStillCoversIt(double lat, double lng) {
        GeoPoint exact = new GeoPoint(lat, lng);
        GeoPoint snapped = LocationPrecisionDerivation.publicCenter(exact);
        double metersPerDegree = 111_320;
        double dy = (snapped.lat() - lat) * metersPerDegree;
        double dx = (snapped.lng() - lng) * metersPerDegree * Math.cos(Math.toRadians(lat));
        assertThat(Math.hypot(dx, dy)).isLessThan(LocationPrecisionDerivation.MAX_OFFSET_M)
                .isLessThan(LostCaseDerivation.PUBLIC_RADIUS_FLOOR_M);
    }

    @Test
    void theMaximumOffsetIsAboutHalfTheDiagonalOfTheCell() {
        assertThat(LocationPrecisionDerivation.MAX_OFFSET_M).isCloseTo(142, within(2.0));
    }

    @Test
    void everyPointOfOneCellSharesOneCenterAndTheNextCellHasAnother() {
        GeoPoint a = LocationPrecisionDerivation.publicCenter(new GeoPoint(6.24415, -75.58120));
        GeoPoint b = LocationPrecisionDerivation.publicCenter(new GeoPoint(6.24425, -75.58120));
        GeoPoint far = LocationPrecisionDerivation.publicCenter(new GeoPoint(6.2460, -75.58120));
        assertThat(b).isEqualTo(a);
        assertThat(far).isNotEqualTo(a);
        assertThat(far.lat() - a.lat()).isCloseTo(0.0018, within(1e-9));
    }

    @Test
    void theSamePointAlwaysGivesTheSameCenter() {
        GeoPoint exact = new GeoPoint(6.2447, -75.5916);
        assertThat(LocationPrecisionDerivation.publicCenter(exact)).isEqualTo(LocationPrecisionDerivation.publicCenter(exact));
    }

    @Test
    void theSnappedCenterIsAlreadyOnTheGrid() {
        GeoPoint once = LocationPrecisionDerivation.publicCenter(new GeoPoint(6.2447, -75.5916));
        assertThat(LocationPrecisionDerivation.publicCenter(once)).isEqualTo(once);
    }
}
