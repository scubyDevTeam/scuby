package co.scuby.platform.db;

import co.scuby.TestcontainersConfiguration;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.context.annotation.Import;

import static co.scuby.platform.db.Spatial.distanceMeters;
import static co.scuby.platform.db.Spatial.geography;
import static co.scuby.platform.db.Spatial.withinMeters;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
@Import(TestcontainersConfiguration.class)
class SpatialTest {

    // Plaza de Bolívar and Parque de la 93, Bogotá: ~9.2 km apart.
    static final GeoPoint PLAZA = new GeoPoint(4.5981, -74.0760);
    static final GeoPoint PARQUE_93 = new GeoPoint(4.6766, -74.0484);

    @Autowired DSLContext db;

    @Test
    void distanceIsInMeters() {
        Double d = db.select(distanceMeters(geography(PLAZA), geography(PARQUE_93))).fetchOne(0, Double.class);
        assertThat(d).isBetween(9_000.0, 9_500.0);
    }

    @Test
    void withinMatchesTheRadius() {
        Boolean near = db.select(org.jooq.impl.DSL.field(withinMeters(geography(PLAZA), geography(PARQUE_93), 10_000)))
                         .fetchOne(0, Boolean.class);
        Boolean far = db.select(org.jooq.impl.DSL.field(withinMeters(geography(PLAZA), geography(PARQUE_93), 5_000)))
                        .fetchOne(0, Boolean.class);
        assertThat(near).isTrue();
        assertThat(far).isFalse();
    }

    @Test
    void pointsOutsideTheGlobeAreRejected() {
        assertThatThrownBy(() -> new GeoPoint(91, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GeoPoint(0, 181)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GeoPoint(-91, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GeoPoint(0, -181)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GeoPoint(Double.NaN, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GeoPoint(0, Double.NaN)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void edgesOfTheGlobeAreAccepted() {
        assertThatCode(() -> new GeoPoint(90, 180)).doesNotThrowAnyException();
        assertThatCode(() -> new GeoPoint(-90, -180)).doesNotThrowAnyException();
    }
}
