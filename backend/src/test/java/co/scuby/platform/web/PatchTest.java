package co.scuby.platform.web;

import org.junit.jupiter.api.Test;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Absent, explicit null and a value stay three different things on a record (docs/eng/api.md · Conventions, PATCH). */
class PatchTest {

    record Point(Double lat, Double lng) {}

    record Body(Patch<String> marks, Patch<List<String>> photoUrls, Patch<Point> lastSeenPoint, Patch<Double> radiusM) {}

    static final JsonMapper JSON = JsonMapper.builder().propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE).build();

    private static Body read(String json) {
        return JSON.readValue(json, Body.class);
    }

    @Test
    void anAbsentFieldIsAbsent() {
        Body b = read("{}");
        assertThat(b.marks().isPresent()).isFalse();
        assertThat(b.photoUrls().isPresent()).isFalse();
        assertThat(b.lastSeenPoint().isPresent()).isFalse();
        assertThat(b.radiusM()).isEqualTo(Patch.absent());
    }

    @Test
    void anExplicitNullIsPresentAndNull() {
        Body b = read("{\"marks\":null,\"photo_urls\":null,\"last_seen_point\":null,\"radius_m\":null}");
        assertThat(b.marks().isPresent()).isTrue();
        assertThat(b.marks().value()).isNull();
        assertThat(b.photoUrls()).isEqualTo(Patch.of(null));
        assertThat(b.lastSeenPoint().isPresent()).isTrue();
        assertThat(b.radiusM().value()).isNull();
    }

    @Test
    void aValueIsReadWithItsOwnTypeNestedRecordsAndListsIncluded() {
        Body b = read("{\"marks\":\"Collar rojo\",\"photo_urls\":[\"a\",\"b\"],\"last_seen_point\":{\"lat\":6.25,\"lng\":-75.59},\"radius_m\":300}");
        assertThat(b.marks()).isEqualTo(Patch.of("Collar rojo"));
        assertThat(b.photoUrls().value()).containsExactly("a", "b");
        assertThat(b.lastSeenPoint().value()).isEqualTo(new Point(6.25, -75.59));
        assertThat(b.radiusM().value()).isEqualTo(300.0);
        assertThat(b.marks().isPresent()).isTrue();
    }

    @Test
    void aWrongTypeInsideIsAJacksonError() {
        assertThatThrownBy(() -> read("{\"photo_urls\":\"a\"}")).isInstanceOf(JacksonException.class);
        assertThatThrownBy(() -> read("{\"last_seen_point\":[1,2]}")).isInstanceOf(JacksonException.class);
    }

    @Test
    void equalityAndToString() {
        assertThat(Patch.<String>absent()).isSameAs(Patch.<Integer>absent());
        assertThat(Patch.of("x")).isEqualTo(Patch.of("x")).isNotEqualTo(Patch.of("y")).isNotEqualTo(Patch.absent());
        assertThat(Patch.of(null)).isNotEqualTo(Patch.absent());
        assertThat(Patch.of("x").hashCode()).isEqualTo(Patch.of("x").hashCode());
        assertThat(Patch.absent()).hasToString("Patch.absent");
        assertThat(Patch.of("x")).hasToString("Patch[x]");
    }
}
