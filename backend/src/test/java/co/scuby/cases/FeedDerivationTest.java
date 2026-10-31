package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class FeedDerivationTest {

    static final Instant T = Instant.parse("2026-10-14T13:00:00Z");

    static FeedRow row(String code, String photo, String place, int count, Instant last) {
        return new FeedRow(code, "Luna", "cat", "small", List.of("black", "tan"), photo, place,
                new GeoPoint(6.2442, -75.5812), T, count, last);
    }

    @Test
    void itemsKeepTheQueryOrderAndCarryTheLostCardFields() {
        FeedView view = FeedDerivation.derive(List.of(
                row("AAAAA", "http://x/a.jpg", null, 2, T.plusSeconds(60)),
                row("BBBBB", null, "Laureles", 0, null)), FeedDerivation.Scope.local, Locale.forLanguageTag("es"));
        assertThat(view.scope()).isEqualTo("local");
        assertThat(view.items()).extracting(FeedView.FeedItem::code).containsExactly("AAAAA", "BBBBB");
        FeedView.FeedItem a = view.items().getFirst();
        assertThat(a.vertical()).isEqualTo("lost");
        assertThat(a.title()).isEqualTo("Luna");
        assertThat(a.species()).isEqualTo("cat");
        assertThat(a.summary()).isEqualTo("Gato · Pequeño · Negro y canela");
        assertThat(a.placeName()).isEqualTo("Zona marcada en el mapa");
        assertThat(a.point()).isEqualTo(new GeoPoint(6.2442, -75.5812));
        assertThat(a.photoUrl()).isEqualTo("http://x/a.jpg");
        assertThat(a.happenedAt()).isEqualTo(T);
        assertThat(a.possibleFind()).isFalse();
        assertThat(a.sightingsCount()).isEqualTo(2);
        assertThat(a.lastSightingAt()).isEqualTo(T.plusSeconds(60));
        assertThat(a.detail()).isNull();
        FeedView.FeedItem b = view.items().get(1);
        assertThat(b.placeName()).isEqualTo("Laureles");
        assertThat(b.photoUrl()).isNull();
        assertThat(b.sightingsCount()).isZero();
        assertThat(b.lastSightingAt()).isNull();
    }

    @Test
    void englishTextAndAnUnnamedPet() {
        var unnamed = new FeedRow("CCCCC", null, "dog", null, List.of(), null, null, new GeoPoint(4.7, -74.0), T, 0, null);
        FeedView view = FeedDerivation.derive(List.of(unnamed), FeedDerivation.Scope.national, Locale.forLanguageTag("en"));
        assertThat(view.scope()).isEqualTo("national");
        assertThat(view.items().getFirst().title()).isEqualTo("");
        assertThat(view.items().getFirst().summary()).isEqualTo("Dog");
        assertThat(view.items().getFirst().placeName()).isEqualTo("Area marked on the map");
    }

    @Test
    void noRowsIsAnEmptyFeedWithTheGivenScope() {
        FeedView view = FeedDerivation.derive(List.of(), FeedDerivation.Scope.national, Locale.forLanguageTag("es"));
        assertThat(view.scope()).isEqualTo("national");
        assertThat(view.items()).isEmpty();
    }
}
