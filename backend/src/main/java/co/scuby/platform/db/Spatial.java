package co.scuby.platform.db;

import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;

/**
 * The PostGIS functions we use, as jOOQ plain-SQL templates. jOOQ's own spatial API is
 * commercial-only; keep every spatial SQL string in this class.
 */
public final class Spatial {

    private Spatial() {}

    /** A WGS 84 geography point; distances on it are in meters. */
    public static Field<Object> geography(GeoPoint p) {
        return DSL.field("ST_SetSRID(ST_MakePoint({0}, {1}), 4326)::geography",
                Object.class, DSL.val(p.lng()), DSL.val(p.lat()));
    }

    public static Field<Double> distanceMeters(Field<?> a, Field<?> b) {
        return DSL.field("ST_Distance({0}, {1})", SQLDataType.DOUBLE, a, b);
    }

    public static Condition withinMeters(Field<?> a, Field<?> b, double meters) {
        return DSL.condition("ST_DWithin({0}, {1}, {2})", a, b, DSL.val(meters));
    }
}
