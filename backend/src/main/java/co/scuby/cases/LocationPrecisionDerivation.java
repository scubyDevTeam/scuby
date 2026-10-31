package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;

/**
 * The center a non-owner sees for «last seen» (docs/product/04-lost-workflow.md · Location precision, decision 63): the
 * exact point snapped to the nearest node of a fixed grid of about 200 m. The owner's circle is often a home, and the
 * feed hands every active case to anyone, so the public never gets the exact point. Snapping is deterministic (a
 * given point always gives the same center, nothing to average away, no secret to keep); the exact point stays in
 * the database for every computation (the 30 km bound on sightings, distances). Pure: no Spring, jOOQ, clock or randomness.
 *
 * <p>The latitude step is fixed; the longitude step is the same distance on the ground at the snapped latitude
 * (latitude step / cos(latitude)), so cells are about square everywhere. The snapped center is at most half a cell
 * diagonal ({@link #MAX_OFFSET_M}, about 142 m) from the exact point, inside the public radius floor of 200 m, so the
 * circle the client draws around it still contains the point.
 */
final class LocationPrecisionDerivation {

    /** About 200 m of latitude (1 degree is 111.32 km). */
    static final double LAT_STEP_DEG = 0.0018;
    /** Half the diagonal of a square cell of {@link #LAT_STEP_DEG}: the largest distance between a point and its center. */
    static final double MAX_OFFSET_M = Math.sqrt(2) / 2 * LAT_STEP_DEG * 111_320;
    /** Near the poles cos(latitude) tends to 0 and the longitude step to infinity: the step is capped at LAT_STEP / this. */
    private static final double MIN_COS = 0.01;
    private static final double DECIMALS = 1e6;

    private LocationPrecisionDerivation() {}

    static GeoPoint publicCenter(GeoPoint exact) {
        double lat = clamp(Math.round(exact.lat() / LAT_STEP_DEG) * LAT_STEP_DEG, 90);
        double lngStep = LAT_STEP_DEG / Math.max(Math.cos(Math.toRadians(lat)), MIN_COS);
        double lng = clamp(Math.round(exact.lng() / lngStep) * lngStep, 180);
        return new GeoPoint(tidy(lat), tidy(lng));
    }

    private static double clamp(double value, double limit) {
        return Math.max(-limit, Math.min(limit, value));
    }

    /** Six decimals (about 0.1 m): drops the binary noise of multiplying a step, so the wire value is stable text. */
    private static double tidy(double degrees) {
        return Math.round(degrees * DECIMALS) / DECIMALS;
    }
}
