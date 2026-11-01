package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.web.Patch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** PATCH /lost-cases/{code} (spec §4.1): the field rules and which columns a body writes. Human review: these are the rules. */
class LostEditDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");
    static final Duration DRIFT = Duration.ofMinutes(5);
    static final GeoPoint STORED = new GeoPoint(6.2442, -75.5812);

    static EditLostRequest body(Patch<List<String>> photos, Patch<String> marks, Patch<PointInput> point,
                                Patch<Double> radius, Patch<OffsetDateTime> at) {
        return new EditLostRequest(photos, marks, point, radius, at);
    }

    static EditLostRequest empty() {
        return body(Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent());
    }

    static EditLostRequest radius(Double r) {
        return body(Patch.absent(), Patch.absent(), Patch.absent(), Patch.of(r), Patch.absent());
    }

    static EditLostRequest photos(List<String> urls) {
        return body(Patch.of(urls), Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent());
    }

    static EditLostRequest point(PointInput p) {
        return body(Patch.absent(), Patch.absent(), Patch.of(p), Patch.absent(), Patch.absent());
    }

    static EditLostRequest lastSeenAt(OffsetDateTime at) {
        return body(Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent(), Patch.of(at));
    }

    static EditLostRequest marks(String m) {
        return body(Patch.absent(), Patch.of(m), Patch.absent(), Patch.absent(), Patch.absent());
    }

    private static Map<String, String> problems(EditLostRequest b) {
        return LostEditDerivation.problems(b, NOW, DRIFT);
    }

    @Test
    void anEmptyBodyHasNoProblemsAndWritesNothing() {
        assertThat(problems(empty())).isEmpty();
        var change = LostEditDerivation.change(empty(), STORED);
        assertThat(change.isEmpty()).isTrue();
        assertThat(change.touchesPet()).isFalse();
    }

    @ParameterizedTest(name = "radius {0} → valid {1}")
    @CsvSource(nullValues = "null", value = {"0.1, true", "300, true", "5000, true", "5000.01, false", "0, false", "-1, false", "NaN, false", "null, false"})
    void theRadiusIsAboveZeroAndAtMost5000(Double r, boolean valid) {
        assertThat(problems(radius(r))).isEqualTo(valid ? Map.of() : Map.of("last_seen_radius_m", "more than 0 and at most 5000"));
    }

    @ParameterizedTest(name = "{0} photos → valid {1}")
    @CsvSource({"1, true", "6, true", "0, false", "7, false"})
    void oneToSixPhotos(int count, boolean valid) {
        List<String> urls = new ArrayList<>(Collections.nCopies(count, "http://localhost/dev-media/a.jpg"));
        assertThat(problems(photos(urls)).containsKey("photo_urls")).isEqualTo(!valid);
    }

    @Test
    void photosCannotBeNullOrContainAnEmptyUrl() {
        assertThat(problems(body(Patch.of(null), Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent())))
                .containsEntry("photo_urls", "1 to 6 photos");
        assertThat(problems(photos(List.of("http://x/a.jpg", " ")))).containsEntry("photo_urls", "a photo url is empty");
    }

    @Test
    void marksAreAtMost500CharactersCountedLikePostgresOrNull() {
        assertThat(problems(marks("🐶".repeat(500)))).isEmpty();
        assertThat(problems(marks("a".repeat(501)))).containsEntry("marks", "at most 500 characters");
        assertThat(problems(marks(null))).isEmpty();
    }

    @ParameterizedTest(name = "point {0},{1} → valid {2}")
    @CsvSource(nullValues = "null", value = {"6.25, -75.59, true", "90, 180, true", "-90, -180, true", "90.1, 0, false",
            "0, -180.1, false", "null, 0, false", "0, null, false"})
    void thePointIsInRange(Double lat, Double lng, boolean valid) {
        assertThat(problems(point(new PointInput(lat, lng))).containsKey("last_seen_point")).isEqualTo(!valid);
    }

    @Test
    void aNullPointIsRefused() {
        assertThat(problems(body(Patch.absent(), Patch.absent(), Patch.of(null), Patch.absent(), Patch.absent())))
                .containsEntry("last_seen_point", "lat -90..90 and lng -180..180");
    }

    @Test
    void lastSeenAtMayBeUpToFiveMinutesAheadAndHasNoLowerBound() {
        OffsetDateTime edge = NOW.plus(DRIFT).atOffset(ZoneOffset.UTC);
        assertThat(problems(lastSeenAt(edge))).isEmpty();
        assertThat(problems(lastSeenAt(edge.plusNanos(1_000_000)))).isEqualTo(Map.of("last_seen_at", "in the future"));
        assertThat(problems(lastSeenAt(OffsetDateTime.parse("2020-01-01T00:00:00-05:00")))).isEmpty();
        assertThat(problems(body(Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent(), Patch.of(null))))
                .isEqualTo(Map.of("last_seen_at", "required"));
    }

    @Test
    void everyBrokenFieldIsNamedAtOnce() {
        var all = body(Patch.of(List.of()), Patch.of("a".repeat(501)), Patch.of(null), Patch.of(0.0), Patch.of(null));
        assertThat(problems(all)).containsOnlyKeys("photo_urls", "marks", "last_seen_point", "last_seen_radius_m", "last_seen_at");
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // label,                 photos, marks, point,  radius, at,    touchesPet, moves, empty
            "'photos only',           true,   false, false,  false,  false, true,       false, false",
            "'marks only',            false,  true,  false,  false,  false, true,       false, false",
            "'radius only',           false,  false, false,  true,   false, false,      false, false",
            "'time only',             false,  false, false,  false,  true,  false,      false, false",
            "'a new point',           false,  false, true,   false,  false, false,      true,  false",
            "'everything',            true,   true,  true,   true,   true,  true,       true,  false",
    })
    void whichColumnsABodyWrites(String label, boolean photos, boolean marks, boolean point, boolean radius, boolean at,
                                 boolean touchesPet, boolean moves, boolean empty) {
        var b = body(photos ? Patch.of(List.of("http://x/a.jpg")) : Patch.absent(), marks ? Patch.of("Collar") : Patch.absent(),
                point ? Patch.of(new PointInput(6.30, -75.60)) : Patch.absent(), radius ? Patch.of(250.0) : Patch.absent(),
                at ? Patch.of(OffsetDateTime.parse("2026-10-14T08:00:00-05:00")) : Patch.absent());
        var change = LostEditDerivation.change(b, STORED);
        assertThat(change.touchesPet()).as(label).isEqualTo(touchesPet);
        assertThat(change.point() != null).as(label).isEqualTo(moves);
        assertThat(change.isEmpty()).as(label).isEqualTo(empty);
        assertThat(change.radiusM()).isEqualTo(radius ? 250.0 : null);
        assertThat(change.lastSeenAt()).isEqualTo(at ? Instant.parse("2026-10-14T13:00:00Z") : null);
        assertThat(change.photoUrls()).isEqualTo(photos ? List.of("http://x/a.jpg") : null);
        assertThat(change.marks()).isEqualTo(marks ? Patch.of("Collar") : Patch.absent());
    }

    @Test
    void aMovedPointCarriesItsSnappedPublicCenter() {
        var change = LostEditDerivation.change(point(new PointInput(6.30, -75.60)), STORED);
        assertThat(change.point()).isEqualTo(new GeoPoint(6.30, -75.60));
        assertThat(change.publicPoint()).isEqualTo(new GeoPoint(6.3, -75.599348));
    }

    @Test
    void theStoredPointIsNotAMoveAndAloneWritesNothing() {
        var change = LostEditDerivation.change(point(new PointInput(6.2442, -75.5812)), STORED);
        assertThat(change.point()).isNull();
        assertThat(change.publicPoint()).isNull();
        assertThat(change.isEmpty()).isTrue();
    }

    @Test
    void explicitNullMarksTouchThePet() {
        var change = LostEditDerivation.change(marks(null), STORED);
        assertThat(change.touchesPet()).isTrue();
        assertThat(change.marks()).isEqualTo(Patch.of(null));
    }

    @Test
    void onlyPhotosNotAlreadyOnThePetNeedAnUploadCheck() {
        assertThat(LostEditDerivation.newPhotos(List.of("a", "b", "c", "b"), List.of("a", "x"))).containsExactly("b", "c");
        assertThat(LostEditDerivation.newPhotos(List.of("a"), List.of("a"))).isEmpty();
        assertThat(LostEditDerivation.newPhotos(List.of(), List.of("a"))).isEmpty();
    }
}
